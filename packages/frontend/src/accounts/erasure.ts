/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 「端末からデータを消す」処理を一手に引き受けるエンジン。
 *
 * ここが解いている問題は2つある。
 *
 * 1. アカウント単位の消去 (`eraseAccountData`)
 *    キー空間 (`mk::<category>::acct:<host>/<id>::<name>`) を **列挙して** 消すので、
 *    「どのモジュールがどのキーを作ったか」を呼び出し側が知らなくてよい。
 *    従来は消す側が個別にキー名を知っている必要があり、モジュールが増えるたびに
 *    消し漏れ（`pizzax::base::<id>` 等の残留）が生まれていた。
 *
 * 2. 端末のワイプ (`wipeDevice`)
 *    `localStorage.clear()` と idb の全 `clear()` をやめ、台帳
 *    (@/lib/storage/local-storage-manifest.js) と キー文法 (@/lib/storage/keys.js) に基づいて
 *    **選別して** 消す。これにより「ヒントの既読」のようなアカウントと無関係な端末状態が
 *    ログアウトで失われなくなる。
 *
 * テスト容易性のため、判定規則はすべて副作用のない純関数として切り出し、
 * I/Oを行う関数は依存(`ErasureDeps`)を注入できる形にしてある。
 */

import type { AccountKey, ParsedStorageKey } from '@/lib/storage/keys.js';
import type { StateDef } from '@/lib/state-store.js';
import { buildKey, parseKey, FALLBACK_PREFIX } from '@/lib/storage/keys.js';
import { classifyLocalStorageKey } from '@/lib/storage/local-storage-manifest.js';

//#region 判定規則（純関数）

/**
 * 全ログアウト時、このlocalStorageキーを消すか？
 *
 * - `idbfallback::` はidbが使えない環境でのkv層の実体そのもの。ここで前方一致で消してしまうと
 *   kv側の「stateのdeviceスコープは残す」という選別が丸ごと無意味になるので、**対象外にして
 *   kv層の判定 (`shouldKeepManagedKeyOnDeviceWipe`) に委ねる**。
 * - 台帳に載っていない未知のキーは**保守的に消す側へ倒す**。残すべきものだけを明示的に
 *   台帳へ載せる運用にしないと、利用者の痕跡が意図せず端末に残り続けるため
 *   （消しすぎは再取得で回復できるが、消し漏れは回復できない）。
 */
export function shouldEraseLocalStorageKeyOnDeviceWipe(key: string): boolean {
	if (key.startsWith(FALLBACK_PREFIX)) return false;
	return classifyLocalStorageKey(key)?.erasure !== 'persistent';
}

/**
 * 全ログアウト時、この`mk::`管理キーを残すか？
 *
 * 残すのは「stateのdeviceスコープ」だけ = アカウントと無関係な端末の状態。
 * account スコープのstate・cache全部・credentials全部は消す。
 */
export function shouldKeepManagedKeyOnDeviceWipe(k: ParsedStorageKey): boolean {
	return k.category === 'state' && k.owner.kind === 'device';
}

/**
 * 全ログアウト時、このkv(idb)の**生キー**を消すか？
 *
 * localStorage側 (`shouldEraseLocalStorageKeyOnDeviceWipe`) と同じ非対称性を採る:
 * **残してよいと明示的に判定できたものだけを残し、それ以外は消す**。
 *
 * `mk::`文法に載らないキーを消す側へ倒すのが肝。ここを「管理下のキーだけ消す」にすると、
 * `pizzax::base`（旧StateStoreのblob。移行後も残置され、**全アカウントのtoken**を含む
 * accountTokens / accountInfos を抱えている）や `accounts`（超旧世代の`{token, id}[]`）が
 * 全ログアウト後も端末に残り続ける。develop の `idb-keyval.clear()` に対する退行になるため、
 * 未知のキーは保守的に消す（消しすぎは再取得で回復できるが、消し漏れは回復できない）。
 *
 * フォールバック環境（idb不可）でも、kv層が`idbfallback::`を剥がした生キーを返すので
 * この判定はそのまま通用する。localStorage側で`idbfallback::`に触らない方針と対になっている。
 */
export function shouldEraseRawIdbKeyOnDeviceWipe(raw: string): boolean {
	const parsed = parseKey(raw);
	if (parsed == null) return true;
	return !shouldKeepManagedKeyOnDeviceWipe(parsed);
}

/**
 * `state/device` は1つのblob（例: `mk::state::device::base` に全device項目が入る）なので
 * キー単位では消せない。blobは残しつつ、機微なプロパティだけを抜いた新しいblobを返す。
 *
 * 変更が無ければ`null`を返す（無駄な書き戻しを避けるため）。
 */
export function stripSensitiveFromDeviceBlob(blob: unknown, sensitiveNames: readonly string[]): Record<string, unknown> | null {
	if (typeof blob !== 'object' || blob == null || Array.isArray(blob)) return null;

	const source = blob as Record<string, unknown>;
	const next: Record<string, unknown> = {};
	let changed = false;

	for (const [k, v] of Object.entries(source)) {
		if (sensitiveNames.includes(k)) {
			changed = true;
			continue;
		}
		next[k] = v;
	}

	return changed ? next : null;
}

/** `StateDef` から「全ログアウトで消すべきdeviceスコープ項目」の名前を拾う */
export function sensitiveNamesOf(def: StateDef): string[] {
	return Object.entries(def)
		.filter(([, v]) => v.where === 'device' && v.sensitive === true)
		.map(([k]) => k);
}

/** `AccountKey` を host / userId に割る。hostは'/'を含まないので最初の'/'で確定する */
export function splitAccountKey(account: AccountKey): { host: string; id: string } | null {
	const slash = account.indexOf('/');
	if (slash <= 0) return null;
	const id = account.slice(slash + 1);
	if (id.length === 0) return null;
	return { host: account.slice(0, slash), id };
}

//#endregion

//#region 拡張点（deviceスコープのblobにper-accountデータを抱えるモジュール用）

/**
 * キー空間に載らない形でアカウント別データを持っているモジュールが、
 * 自分の消去処理をここへ登録するための拡張点。
 *
 * 列挙ベースの削除で足りるモジュールは登録不要（＝基本は使わなくてよい）。
 */
export type AccountErasureHook = (account: AccountKey) => Promise<void>;

const hooks: AccountErasureHook[] = [];

export function registerAccountErasureHook(hook: AccountErasureHook): void {
	hooks.push(hook);
}

/** テスト用。登録済みフックを差し替える */
export function _setAccountErasureHooksForTesting(next: readonly AccountErasureHook[]): void {
	hooks.length = 0;
	hooks.push(...next);
}

//#endregion

//#region 依存の注入

export type ErasureKv = {
	/** 実体に載っている生キーの全列挙。`mk::`管理外のキーも含む（全ログアウトの掃除対象判定に要る） */
	listRawKeys: () => Promise<string[]>;
	listManagedKeys: () => Promise<ParsedStorageKey[]>;
	delMany: (keys: string[]) => Promise<void>;
	get: (key: string) => Promise<any>;
	set: (key: string, val: any) => Promise<void>;
};

export type ErasureDeps = {
	kv: ErasureKv;
	localStorage: Pick<Storage, 'length' | 'key' | 'removeItem'>;
	/** prefer内のアカウントスコープレコードを消す */
	clearAccountSettings: (host: string, id: string) => Promise<void>;
	/** 可搬性ロースター(`prefer.s.accounts`)から除く */
	removeFromRoster: (host: string, id: string) => Promise<void>;
	/** 資格情報台帳からエントリを消す */
	removeLedgerEntry: (account: AccountKey) => Promise<void>;
	/** deviceスコープblobキー → そこから抜くべきプロパティ名 */
	sensitiveDeviceState: () => Promise<ReadonlyMap<string, readonly string[]>>;
	/** レガシーidbデータベースの削除（残骸掃除） */
	deleteLegacyDatabases: () => Promise<void>;
};

/**
 * 実体(idb / prefer / ledger)は副作用の重いモジュールなので、静的importせず
 * I/Oが実際に走る瞬間まで解決を遅延させる。こうしておくと、このモジュールをimportするだけの
 * 単体テストがidbを引きずり込まない（@/accounts/ledger.js と同じ方針）。
 */
function defaultDeps(): ErasureDeps {
	return {
		kv: {
			listRawKeys: async () => (await import('@/lib/storage/kv.js')).listRawKeys(),
			listManagedKeys: async () => (await import('@/lib/storage/kv.js')).listManagedKeys(),
			delMany: async (keys) => (await import('@/lib/storage/kv.js')).delMany(keys),
			get: async (key) => (await import('@/lib/storage/kv.js')).get(key),
			set: async (key, val) => (await import('@/lib/storage/kv.js')).set(key, val),
		},
		localStorage: window.localStorage,
		clearAccountSettings: async (host, id) => {
			const { prefer } = await import('@/preferences.js');
			prefer.clearAccountSettingsFromDevice(host, id);
		},
		removeFromRoster: async (host, id) => {
			const { prefer } = await import('@/preferences.js');
			prefer.commit('accounts', prefer.s.accounts.filter(x => x[0] !== host || x[1].id !== id));
		},
		removeLedgerEntry: async (account) => (await import('@/accounts/ledger.js')).removeEntry(account),
		sensitiveDeviceState: async () => {
			const { store } = await import('@/store.js');
			const { LEGACY_STORE_KEY } = await import('@/accounts/legacy-ledger.js');

			const map = new Map<string, readonly string[]>();

			// 旧台帳(accountTokens / accountInfos)は`mk::state::device::base`に同居している。
			// このキーはstate/deviceなのでワイプ後も残るため、資格情報が端末に残り続けてしまう。
			// store.defには載っていない（移設済み）ので明示的に抜く。
			// 移行期間が終わり @/accounts/legacy-ledger.js を消すときに、この2つも一緒に消してよい。
			map.set(LEGACY_STORE_KEY, [...sensitiveNamesOf(store.def), 'accountTokens', 'accountInfos']);

			return map;
		},
		deleteLegacyDatabases,
	};
}

//#endregion

//#region 消去の実行

/**
 * アカウント`account`に属するローカルデータをこの端末から消す。
 *
 * リロード不要で完結する（＝他アカウントからのログアウトで画面が飛ばない）。
 * 冪等なので、既に消えているアカウントに対して呼んでも安全。
 */
export async function eraseAccountData(account: AccountKey, deps: ErasureDeps = defaultDeps()): Promise<void> {
	const parsed = splitAccountKey(account);
	if (parsed == null) {
		console.error('eraseAccountData: malformed account key', account);
		return;
	}
	const { host, id } = parsed;

	// state / cache のアカウントスコープを列挙して消す。
	// キー名を呼び出し側が知らなくてよいのが肝（消し漏れの温床を構造的に潰す）。
	const targets = (await deps.kv.listManagedKeys())
		.filter(k => k.owner.kind === 'account' && k.owner.account === account);
	if (targets.length > 0) {
		await deps.kv.delMany(targets.map(buildKey));
	}

	// 設定(prefer)内のアカウントスコープレコードと、可搬性ロースターからの除去
	await deps.clearAccountSettings(host, id);
	await deps.removeFromRoster(host, id);

	// 資格情報台帳
	await deps.removeLedgerEntry(account);

	// 拡張点。1つ失敗しても残りは続行する（消去は「できるだけ消す」が正しい）
	for (const hook of hooks) {
		try {
			await hook(account);
		} catch (err) {
			console.error('account erasure hook failed', err);
		}
	}
}

/**
 * 端末のワイプ（全アカウントからのログアウト）。
 *
 * **`persistent`分類の状態は残す。** ヒントの既読・言語・テーマといった
 * 「アカウントと無関係な端末の状態」まで消えてしまう問題(#16713)への対処。
 * 真の全消去が必要ならブラウザのサイトデータ削除を使えばよい、という整理になっている。
 */
export async function wipeDevice(deps: ErasureDeps = defaultDeps()): Promise<void> {
	//#region localStorage: clear()せず台帳に基づいて選別する
	const ls = deps.localStorage;
	const lsTargets: string[] = [];
	for (let i = 0; i < ls.length; i++) {
		const key = ls.key(i);
		if (key != null && shouldEraseLocalStorageKeyOnDeviceWipe(key)) lsTargets.push(key);
	}
	for (const key of lsTargets) {
		ls.removeItem(key);
	}
	//#endregion

	//#region idb(kv): clear()せずキー文法に基づいて選別する
	// 生キーを列挙する（管理外の旧キーも掃除対象に含めるため。詳細は shouldEraseRawIdbKeyOnDeviceWipe）
	const kvTargets = (await deps.kv.listRawKeys()).filter(shouldEraseRawIdbKeyOnDeviceWipe);
	if (kvTargets.length > 0) {
		await deps.kv.delMany(kvTargets);
	}
	//#endregion

	//#region 残したblobから機微なプロパティだけを抜く
	// state/deviceは1キーに全項目が入ったblobなので、キー単位の削除では粒度が足りない
	const sensitive = await deps.sensitiveDeviceState();
	for (const [key, names] of sensitive) {
		if (names.length === 0) continue;
		try {
			const stripped = stripSensitiveFromDeviceBlob(await deps.kv.get(key), names);
			if (stripped != null) await deps.kv.set(key, stripped);
		} catch (err) {
			console.error('failed to strip sensitive device state', key, err);
		}
	}
	//#endregion

	await deps.deleteLegacyDatabases();
}

/** レガシーidbデータベースの削除。移行前バージョンが作った残骸を掃除する */
async function deleteLegacyDatabases(): Promise<void> {
	const abortController = new AbortController();
	const timeout = window.setTimeout(() => abortController.abort(), 5000);

	const promises = ['MisskeyClient'].map(name => new Promise<void>((res, rej) => {
		const req = indexedDB.deleteDatabase(name);
		req.onsuccess = () => res();
		req.onerror = e => rej(e);
		req.onblocked = () => abortController.signal.aborted && rej(new Error('Operation aborted'));
	}));

	try {
		await Promise.race([
			Promise.all(promises),
			new Promise((_, rej) => abortController.signal.addEventListener('abort', () => rej(new Error('Operation timed out')))),
		]);
	} catch {
		// 残骸掃除なので失敗しても続行する
	} finally {
		window.clearTimeout(timeout);
	}
}

//#endregion
