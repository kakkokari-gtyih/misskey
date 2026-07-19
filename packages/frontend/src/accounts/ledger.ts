/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 資格情報（token）の台帳。
 *
 * 「状態」(@/store.js) からtokenを追い出して独立させたもの。これにより
 * 状態 / 設定 / 資格情報 の三者が別々のキー空間に分かれ、
 * 「デバイス状態は永続化してよい」と言い切れるようになる。
 *
 * 永続化先は `mk::credentials::device::accounts` 固定で、StateStore(Pizzax)は経由せず
 * @/lib/storage/kv.js を直接使う。
 *
 * NOTE: 可搬性のあるアカウント一覧（token無し）は引き続き `prefer.s.accounts` にも載っている。
 * あちらは「設定のバックアップに含めてよいロースター」であり、真実の源はこちらの台帳。
 */

import type * as Misskey from 'misskey-js';
import type { AccountKey } from '@/lib/storage/keys.js';
import type { LegacyLedgerKv, LegacyWritableEntry } from '@/accounts/legacy-ledger.js';
import { accountKeyOf, buildKey } from '@/lib/storage/keys.js';
import { readLegacyLedger, writeLegacyLedger } from '@/accounts/legacy-ledger.js';
import { deepClone } from '@/utility/clone.js';

export const LEDGER_KEY = buildKey({
	category: 'credentials',
	owner: { kind: 'device' },
	name: 'accounts',
});

export type LedgerEntry = {
	host: string;
	id: string;
	username: string;
	/** tokenを持たないアカウント（設定のプロファイルを復元した直後など）もあり得る */
	token: string | null;
	/** 表示用のキャッシュ。無くても動作する */
	user: Misskey.entities.MeDetailed | null;
};

export type Ledger = {
	entries: LedgerEntry[];
	/** クラウド同期・バックアップの保存先アカウント。実際に transport を切り替えるのはM5 */
	primaryAccountKey: AccountKey | null;
};

export type LedgerKv = {
	get: (key: string) => Promise<any>;
	set: (key: string, val: any) => Promise<void>;
};

/** 旧台帳との橋渡し。移行期間中のみ存在する（@/accounts/legacy-ledger.js を参照） */
export type LegacyLedgerBridge = {
	read: () => Promise<{ accountTokens: Record<string, string>; accountInfos: Record<string, Misskey.entities.MeDetailed> }>;
	write: (entries: readonly LegacyWritableEntry[]) => Promise<void>;
};

export function keyOfEntry(entry: Pick<LedgerEntry, 'host' | 'id'>): AccountKey {
	return accountKeyOf(entry.host, entry.id);
}

function toPlain<T>(x: T): T {
	// Vueのreactive proxyやRefが混ざったままだとidbのstructuredCloneで落ちるので必ず素のオブジェクトにする
	return deepClone(x as any) as T;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
	return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isValidEntry(x: unknown): x is LedgerEntry {
	if (!isPlainObject(x)) return false;
	return typeof x.host === 'string' && x.host.length > 0
		&& typeof x.id === 'string' && x.id.length > 0;
}

/**
 * 永続化された値を台帳として解釈する。
 * 「まだ台帳が無い（=未移行）」と「台帳はあるが空（=移行済みで全ログアウト済み）」を
 * 区別する必要があるので、前者はnullを返す。
 */
export function normalizeLedger(raw: unknown): Ledger | null {
	if (!isPlainObject(raw)) return null;
	if (!Array.isArray(raw.entries)) return null;

	const entries: LedgerEntry[] = [];
	for (const e of raw.entries) {
		if (!isValidEntry(e)) continue;
		entries.push({
			host: e.host,
			id: e.id,
			username: typeof e.username === 'string' ? e.username : '',
			token: typeof e.token === 'string' ? e.token : null,
			user: isPlainObject(e.user) ? e.user as Misskey.entities.MeDetailed : null,
		});
	}

	const rawPrimary = raw.primaryAccountKey;
	const primaryAccountKey = typeof rawPrimary === 'string' ? rawPrimary as AccountKey : null;

	return {
		entries,
		primaryAccountKey: choosePrimaryAccountKey(entries, primaryAccountKey),
	};
}

/**
 * プライマリアカウントの選択ロジック。
 *
 * - 現在のプライマリがまだ台帳に居るならそのまま
 * - 居ない（初回 / 削除された）なら残っているエントリの先頭
 * - 台帳が空ならnull
 *
 * M5でダイアログによるユーザー選択に差し替える想定なので、ここだけ独立した関数にしてある。
 */
export function choosePrimaryAccountKey(entries: readonly LedgerEntry[], current: AccountKey | null): AccountKey | null {
	if (current != null && entries.some(e => keyOfEntry(e) === current)) return current;
	return entries.length > 0 ? keyOfEntry(entries[0]) : null;
}

/** upsert結果を返す純関数（既存エントリは置き換え、無ければ末尾に追加） */
export function upsertIntoEntries(entries: readonly LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
	const key = keyOfEntry(entry);
	const index = entries.findIndex(e => keyOfEntry(e) === key);
	if (index < 0) return [...entries, entry];
	const next = [...entries];
	next[index] = entry;
	return next;
}

/**
 * 旧台帳（accountTokens / accountInfos）から新台帳のエントリ列を組み立てる純関数。
 *
 * usernameは accountInfos にしか無いため、tokenだけあって情報キャッシュが無いアカウントでは
 * 空文字になる。表示名は `prefer.s.accounts`（ロースター）側から補完できるので、
 * ここでロースターを読みに行って循環依存を作ることはしない（@/accounts.js の getAccounts() を参照）。
 */
export function ledgerEntriesFromLegacy(legacy: {
	accountTokens: Record<string, string>;
	accountInfos: Record<string, Misskey.entities.MeDetailed>;
}): LedgerEntry[] {
	const entries: LedgerEntry[] = [];
	const seen = new Set<string>();

	for (const key of [...Object.keys(legacy.accountTokens), ...Object.keys(legacy.accountInfos)]) {
		if (seen.has(key)) continue;
		seen.add(key);

		// hostは'/'を含まないので最初の'/'で確定する
		const slash = key.indexOf('/');
		if (slash <= 0) continue;
		const host = key.slice(0, slash);
		const id = key.slice(slash + 1);
		if (id.length === 0) continue;

		const user = legacy.accountInfos[key] ?? null;
		const token = legacy.accountTokens[key] ?? null;
		if (user == null && token == null) continue;

		entries.push({
			host,
			id,
			username: typeof user?.username === 'string' ? user.username : '',
			token,
			user,
		});
	}

	return entries;
}

export class AccountLedger {
	public readonly ready: Promise<void>;

	private ledger: Ledger = { entries: [], primaryAccountKey: null };
	private kv: LedgerKv;
	private legacy: LegacyLedgerBridge | null;

	// 書き込みを直列化する（read-modify-writeの取りこぼしを防ぐ）
	private writeQueue: Promise<unknown> = Promise.resolve();

	constructor(kv: LedgerKv, legacy: LegacyLedgerBridge | null = null) {
		this.kv = kv;
		this.legacy = legacy;
		this.ready = this.init();
	}

	private async init(): Promise<void> {
		let stored: unknown;
		try {
			stored = await this.kv.get(LEDGER_KEY);
		} catch (err) {
			console.error('failed to read the credentials ledger', err);
			stored = undefined;
		}

		const normalized = normalizeLedger(stored);
		if (normalized != null) {
			// 既に新台帳がある（空でも「移行済み」を意味するのでここで確定する）
			this.ledger = normalized;
			return;
		}

		await this.migrateFromLegacy();
	}

	/**
	 * 旧台帳からの移行。boot時（初回ロード時）に一度だけ走る。
	 * 新台帳のキーが書かれた時点で「移行済み」になるので冪等。
	 */
	private async migrateFromLegacy(): Promise<void> {
		if (this.legacy == null) return;

		let entries: LedgerEntry[];
		try {
			entries = ledgerEntriesFromLegacy(await this.legacy.read());
		} catch (err) {
			// 旧データすら読めない。ここで台帳を空のままにするしかないが、bootは止めない
			console.error('failed to read the legacy credentials ledger', err);
			return;
		}

		// 新規ユーザー（移行元が空）なら何も書かない
		if (entries.length === 0) return;

		this.ledger = {
			entries,
			primaryAccountKey: choosePrimaryAccountKey(entries, null),
		};

		try {
			await this.kv.set(LEDGER_KEY, toPlain(this.ledger));
		} catch (err) {
			// 永続化には失敗したが、メモリ上の台帳には旧データが載っているのでこのセッションは通常どおり動く
			// （= フォールバックパス。ユーザーが全ログアウト状態に見えることはない）。
			// 新台帳のキーは書かれていないので次回起動で移行がやり直される。
			console.error('failed to persist the migrated credentials ledger', err);
		}
	}

	private enqueue<T>(job: () => Promise<T>): Promise<T> {
		const promise = this.writeQueue.then(job, job);
		this.writeQueue = promise.catch(() => {});
		return promise;
	}

	private persist(next: Ledger): Promise<void> {
		this.ledger = next;
		return this.enqueue(async () => {
			await this.kv.set(LEDGER_KEY, toPlain(next));
			// 移行期間中のdual-write。詳細は @/accounts/legacy-ledger.js
			if (this.legacy != null) await this.legacy.write(next.entries);
		});
	}

	public listEntries(): LedgerEntry[] {
		return this.ledger.entries;
	}

	public getEntry(account: AccountKey): LedgerEntry | null {
		return this.ledger.entries.find(e => keyOfEntry(e) === account) ?? null;
	}

	public upsertEntry(entry: LedgerEntry): Promise<void> {
		const entries = upsertIntoEntries(this.ledger.entries, toPlain(entry));
		return this.persist({
			entries,
			primaryAccountKey: choosePrimaryAccountKey(entries, this.ledger.primaryAccountKey),
		});
	}

	public removeEntry(account: AccountKey): Promise<void> {
		const entries = this.ledger.entries.filter(e => keyOfEntry(e) !== account);
		return this.persist({
			entries,
			primaryAccountKey: choosePrimaryAccountKey(entries, this.ledger.primaryAccountKey),
		});
	}

	public getPrimaryAccountKey(): AccountKey | null {
		return this.ledger.primaryAccountKey;
	}

	public setPrimaryAccountKey(account: AccountKey | null): Promise<void> {
		return this.persist({
			entries: this.ledger.entries,
			primaryAccountKey: choosePrimaryAccountKey(this.ledger.entries, account),
		});
	}
}

//#region シングルトン（アプリ本体が使う入口）

/**
 * ストレージ実体(@/lib/storage/kv.js → idb-proxy)は副作用の重いモジュールなので、
 * 静的importせずI/Oが実際に走る瞬間まで解決を遅延させる。
 * こうしておくと、このモジュールをimportするだけの単体テストがidbを引きずり込まない。
 */
const lazyKv: LedgerKv & LegacyLedgerKv = {
	get: async (key) => (await import('@/lib/storage/kv.js')).get(key),
	set: async (key, val) => (await import('@/lib/storage/kv.js')).set(key, val),
};

const instance = new AccountLedger(lazyKv, {
	// 旧台帳は `mk::state::device::base` に載っているが、そのキー自体がキー空間移行
	// (`pizzax::base` => `mk::*`) によって初めて作られる。移行の完了を待たずに読むと
	// 移行前のユーザーで「アカウントが1件も無い」と誤認してしまうので、必ず待ってから読む。
	read: async () => {
		await (await import('@/lib/storage/migrate.js')).migrateLegacyKeys();
		return readLegacyLedger(lazyKv);
	},
	write: (entries) => writeLegacyLedger(lazyKv, entries),
});

/**
 * 初回ロード完了。`store.ready` と同様にboot時に待つこと。
 * これを待たずに listEntries() を呼ぶと空配列が返る。
 */
export const ledgerReady: Promise<void> = instance.ready;

export function listEntries(): LedgerEntry[] {
	return instance.listEntries();
}

export function getEntry(account: AccountKey): LedgerEntry | null {
	return instance.getEntry(account);
}

export function upsertEntry(entry: LedgerEntry): Promise<void> {
	return instance.upsertEntry(entry);
}

export function removeEntry(account: AccountKey): Promise<void> {
	return instance.removeEntry(account);
}

export function getPrimaryAccountKey(): AccountKey | null {
	return instance.getPrimaryAccountKey();
}

export function setPrimaryAccountKey(account: AccountKey | null): Promise<void> {
	return instance.setPrimaryAccountKey(account);
}

//#endregion
