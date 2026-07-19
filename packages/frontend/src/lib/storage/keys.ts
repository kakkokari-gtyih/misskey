/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * クライアント永続化キーの文法を一手に引き受けるレイヤ。
 *
 * mk::<category>::<owner>::<name>
 *   <category> := state | cache | credentials
 *   <owner>    := device | acct:<host>/<userId> | server:<host>
 *
 * ここには意図的にMisskeyのドメイン知識（$iやconfigのhost等）を持ち込まない。
 * 純粋な文字列変換に閉じることで、ストレージ実体もログイン状態も用意せずに
 * 文法だけを単体テストできるようにするため。
 */

const PREFIX = 'mk::';
const SEP = '::';

/**
 * idbが使えない環境でlocalStorageへフォールバックする際、実体キーに付くプレフィックス。
 *
 * 実装は @/utility/idb-proxy.js だが、あちらはモジュールのトップレベルでidbを触るため
 * importするだけで副作用が走る。この定数だけを参照したい層（消去エンジン等）が
 * それを引きずり込まずに済むよう、文字列の定義はこの純粋なキー文法レイヤに置く。
 */
export const FALLBACK_PREFIX = 'idbfallback::';

/** `host + '/' + userId`。既存のアカウント台帳の識別子表記と同一形式 */
export type AccountKey = `${string}/${string}`;

export type StorageCategory = 'state' | 'cache' | 'credentials';

export type StorageOwner = {
	kind: 'device';
} | {
	kind: 'account';
	account: AccountKey;
} | {
	kind: 'server';
	host: string;
};

export type ParsedStorageKey = {
	category: StorageCategory;
	owner: StorageOwner;
	name: string;
};

const CATEGORIES = ['state', 'cache', 'credentials'] as const satisfies readonly StorageCategory[];

function isCategory(x: string): x is StorageCategory {
	return (CATEGORIES as readonly string[]).includes(x);
}

export function accountKeyOf(host: string, userId: string): AccountKey {
	return `${host}/${userId}`;
}

function buildOwner(owner: StorageOwner): string {
	switch (owner.kind) {
		case 'device': return 'device';
		case 'account': return `acct:${owner.account}`;
		case 'server': return `server:${owner.host}`;
	}
}

function parseOwner(raw: string): StorageOwner | null {
	if (raw === 'device') return { kind: 'device' };

	if (raw.startsWith('acct:')) {
		const body = raw.slice('acct:'.length);
		// hostは'/'を含まないので最初の'/'で確定する
		const slash = body.indexOf('/');
		if (slash <= 0) return null;
		const host = body.slice(0, slash);
		const userId = body.slice(slash + 1);
		if (userId.length === 0) return null;
		return { kind: 'account', account: accountKeyOf(host, userId) };
	}

	if (raw.startsWith('server:')) {
		const host = raw.slice('server:'.length);
		if (host.length === 0) return null;
		return { kind: 'server', host };
	}

	return null;
}

export function buildKey(k: ParsedStorageKey): string {
	return PREFIX + k.category + SEP + buildOwner(k.owner) + SEP + k.name;
}

/**
 * `mk::`管理下でないキー・文法違反のキーはnullを返す。
 * nameにはドットや`::`が入り得るので、区切りは先頭からの3分割で行い
 * 残りは全てnameとして扱う（`split(SEP)`で要素数を固定しない）。
 */
export function parseKey(raw: string): ParsedStorageKey | null {
	if (!raw.startsWith(PREFIX)) return null;
	const body = raw.slice(PREFIX.length);

	const catEnd = body.indexOf(SEP);
	if (catEnd <= 0) return null;
	const category = body.slice(0, catEnd);
	if (!isCategory(category)) return null;

	const rest = body.slice(catEnd + SEP.length);
	// ownerは'::'を含まない（hostはホスト名、userIdは英数ID）ので最初の区切りで確定する
	const ownerEnd = rest.indexOf(SEP);
	if (ownerEnd <= 0) return null;
	const owner = parseOwner(rest.slice(0, ownerEnd));
	if (owner == null) return null;

	const name = rest.slice(ownerEnd + SEP.length);
	if (name.length === 0) return null;

	return { category, owner, name };
}
