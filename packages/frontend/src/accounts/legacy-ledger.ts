/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * **移行期間中の後方互換のためだけに存在するモジュール。数バージョン後に削除すること。**
 *
 * 資格情報の台帳は `mk::credentials::device::accounts`（@/accounts/ledger.js）へ移設したが、
 * 旧台帳（`store.s.accountTokens` / `store.s.accountInfos` = StateStore('base') のblobの
 * 該当プロパティ）にも当面は書き続ける（dual-write）。書き込み先の2キーについては
 * `LEGACY_ROLLBACK_KEY` / `LEGACY_STORE_KEY` の説明を参照。
 *
 * 理由: このリリースをロールバックした場合、旧バージョンは新しい台帳を知らないため、
 * 旧台帳が空だと**全アカウントが再ログインを要求される**。tokenを失う事故を避けるため、
 * 移行期間中は二重に持つ。
 *
 * `store`（StateStore）を経由しないのは、`store.ts` の定義から accountTokens / accountInfos を
 * 削除済みで `store.set('accountTokens', ...)` が型エラーになるため。ここではKVを直接叩き、
 * 旧キーの該当プロパティだけを読み書きする。
 *
 * NOTE: StateStore も同じidbキー（`mk::state::device::base`）にread-modify-writeするため、
 * 厳密には競合しうる。書き込み頻度がログイン/ログアウト時に限られること、競合しても
 * 失われるのは「片方の直前の1書き込み」だけであることから、暫定措置として許容している。
 * どのみちこのモジュールごと消える。
 */

import type * as Misskey from 'misskey-js';
import type { AccountKey } from '@/lib/storage/keys.js';
import { buildKey } from '@/lib/storage/keys.js';

/**
 * 旧台帳が同居しているStateStore('base')のデバイススコープキー（**新**キー空間側）。
 *
 * 移行元として読むのはこちら。`pizzax::base` ではない理由:
 * localStorageフォールバック環境では `migrateLegacyKeys()` が `dropLegacy = true` で走り、
 * コピー後に `pizzax::base` を**消す**（@/lib/storage/migrate.js）。
 * bridge は移行の完了を待ってから読むので、そのタイミングで確実に存在するのは
 * コピー先であるこのキーの方だけ。
 */
export const LEGACY_STORE_KEY = buildKey({
	category: 'state',
	owner: { kind: 'device' },
	name: 'base',
});

/**
 * ロールバック時の受け皿となる**旧文法の生キー**。
 *
 * dual-writeの目的は「このリリースをロールバックした際に旧バージョンがtokenを読めること」なので、
 * 書き込み先は旧バージョンが実際に読むキーでなければ意味がない。
 * develop の Pizzax は `deviceStateKeyName = 'pizzax::' + key`（= `pizzax::base`）しか見ないため、
 * `mk::` 文法へ変換せず旧文法のリテラルのまま書く。
 *
 * このキーは `mk::` 管理外なので、全ログアウト時は
 * @/accounts/erasure.js の `shouldEraseRawIdbKeyOnDeviceWipe` が「未知のキー」として消す。
 */
export const LEGACY_ROLLBACK_KEY = 'pizzax::base';

export type LegacyLedgerSnapshot = {
	accountTokens: Record<AccountKey, string>;
	accountInfos: Record<AccountKey, Misskey.entities.MeDetailed>;
};

export type LegacyLedgerKv = {
	get: (key: string) => Promise<any>;
	set: (key: string, val: any) => Promise<void>;
};

/** 旧台帳の形（LedgerEntryの部分集合）。ledger.tsからの循環importを避けるためここで最小限だけ定義する */
export type LegacyWritableEntry = {
	host: string;
	id: string;
	token: string | null;
	user: Misskey.entities.MeDetailed | null;
};

function isPlainObject(x: unknown): x is Record<string, unknown> {
	return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 旧台帳の該当プロパティだけを取り出す純関数（壊れた値は握り潰して空として扱う） */
export function extractLegacyLedger(raw: unknown): LegacyLedgerSnapshot {
	const base = isPlainObject(raw) ? raw : {};
	return {
		accountTokens: isPlainObject(base.accountTokens) ? base.accountTokens as LegacyLedgerSnapshot['accountTokens'] : {},
		accountInfos: isPlainObject(base.accountInfos) ? base.accountInfos as LegacyLedgerSnapshot['accountInfos'] : {},
	};
}

/** 新台帳のエントリ列から旧台帳の2つのマップを組み立てる純関数 */
export function buildLegacyLedger(entries: readonly LegacyWritableEntry[]): LegacyLedgerSnapshot {
	const accountTokens: LegacyLedgerSnapshot['accountTokens'] = {};
	const accountInfos: LegacyLedgerSnapshot['accountInfos'] = {};

	for (const entry of entries) {
		const key: AccountKey = `${entry.host}/${entry.id}`;
		if (entry.token != null) accountTokens[key] = entry.token;
		if (entry.user != null) accountInfos[key] = entry.user;
	}

	return { accountTokens, accountInfos };
}

export async function readLegacyLedger(kv: LegacyLedgerKv): Promise<LegacyLedgerSnapshot> {
	return extractLegacyLedger(await kv.get(LEGACY_STORE_KEY));
}

async function mergeInto(kv: LegacyLedgerKv, key: string, snapshot: LegacyLedgerSnapshot): Promise<void> {
	const current = await kv.get(key);
	const base = isPlainObject(current) ? { ...current } : {};
	await kv.set(key, { ...base, ...snapshot });
}

/**
 * 旧台帳へ書き戻す（dual-write）。同じキーに同居する他の状態は保持する。
 *
 * 2箇所へ書く:
 * - `LEGACY_ROLLBACK_KEY` (`pizzax::base`) … ロールバック先の旧バージョンが読むキー。dual-writeの本来の目的
 * - `LEGACY_STORE_KEY` (`mk::state::device::base`) … 移行でコピー済みのblob。
 *   ここを更新しないと、単体ログアウトしたアカウントのtokenがこのblobに残り続ける
 */
export async function writeLegacyLedger(kv: LegacyLedgerKv, entries: readonly LegacyWritableEntry[]): Promise<void> {
	const snapshot = buildLegacyLedger(entries);
	await mergeInto(kv, LEGACY_ROLLBACK_KEY, snapshot);
	await mergeInto(kv, LEGACY_STORE_KEY, snapshot);
}
