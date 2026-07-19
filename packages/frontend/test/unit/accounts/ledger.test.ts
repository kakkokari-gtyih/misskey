/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import type * as Misskey from 'misskey-js';
import type { LedgerEntry, LedgerKv, LegacyLedgerBridge } from '@/accounts/ledger.js';
import {
	AccountLedger,
	LEDGER_KEY,
	choosePrimaryAccountKey,
	ledgerEntriesFromLegacy,
	normalizeLedger,
	upsertIntoEntries,
} from '@/accounts/ledger.js';
import { buildLegacyLedger, extractLegacyLedger } from '@/accounts/legacy-ledger.js';

const HOST = 'example.com';

function memoryKv(initial: Record<string, any> = {}): LedgerKv & { dump: () => Record<string, any> } {
	const store = new Map<string, any>(Object.entries(initial));
	return {
		get: async (key) => store.get(key),
		set: async (key, val) => { store.set(key, val); },
		dump: () => Object.fromEntries(store),
	};
}

function entry(id: string, over: Partial<LedgerEntry> = {}): LedgerEntry {
	return {
		host: HOST,
		id,
		username: `user-${id}`,
		token: `token-${id}`,
		user: null,
		...over,
	};
}

function userOf(id: string, username: string): Misskey.entities.MeDetailed {
	return { id, username } as Misskey.entities.MeDetailed;
}

describe('choosePrimaryAccountKey', () => {
	test('台帳が空ならnull', () => {
		expect(choosePrimaryAccountKey([], null)).toBe(null);
		expect(choosePrimaryAccountKey([], `${HOST}/a`)).toBe(null);
	});

	test('未設定なら先頭のエントリが選ばれる', () => {
		expect(choosePrimaryAccountKey([entry('a'), entry('b')], null)).toBe(`${HOST}/a`);
	});

	test('現在のプライマリが残っていれば維持される', () => {
		expect(choosePrimaryAccountKey([entry('a'), entry('b')], `${HOST}/b`)).toBe(`${HOST}/b`);
	});

	test('現在のプライマリが台帳から消えていれば先頭へ移る', () => {
		expect(choosePrimaryAccountKey([entry('b'), entry('c')], `${HOST}/a`)).toBe(`${HOST}/b`);
	});
});

describe('upsertIntoEntries', () => {
	test('無ければ末尾に追加する', () => {
		expect(upsertIntoEntries([entry('a')], entry('b')).map(e => e.id)).toEqual(['a', 'b']);
	});

	test('既存は順序を保ったまま置き換える', () => {
		const next = upsertIntoEntries([entry('a'), entry('b'), entry('c')], entry('b', { token: 'renewed' }));
		expect(next.map(e => e.id)).toEqual(['a', 'b', 'c']);
		expect(next[1].token).toBe('renewed');
	});
});

describe('normalizeLedger', () => {
	test('未移行（値が無い / 壊れている）はnull', () => {
		expect(normalizeLedger(undefined)).toBe(null);
		expect(normalizeLedger(null)).toBe(null);
		expect(normalizeLedger('x')).toBe(null);
		expect(normalizeLedger({})).toBe(null);
	});

	test('空の台帳は「移行済みで空」として解釈される', () => {
		expect(normalizeLedger({ entries: [], primaryAccountKey: null })).toEqual({ entries: [], primaryAccountKey: null });
	});

	test('壊れたエントリは落とし、プライマリは選び直される', () => {
		const result = normalizeLedger({
			entries: [{ foo: 1 }, { host: HOST, id: 'a' }],
			primaryAccountKey: `${HOST}/gone`,
		});
		expect(result).toEqual({
			entries: [{ host: HOST, id: 'a', username: '', token: null, user: null }],
			primaryAccountKey: `${HOST}/a`,
		});
	});
});

describe('ledgerEntriesFromLegacy', () => {
	test('tokenと情報キャッシュを突き合わせて写像する', () => {
		const entries = ledgerEntriesFromLegacy({
			accountTokens: { [`${HOST}/a`]: 'token-a', [`${HOST}/b`]: 'token-b' },
			accountInfos: { [`${HOST}/a`]: userOf('a', 'alice') },
		});
		expect(entries).toEqual([
			{ host: HOST, id: 'a', username: 'alice', token: 'token-a', user: userOf('a', 'alice') },
			// 情報キャッシュが無いとusernameは空。呼び出し側がロースターから補完する
			{ host: HOST, id: 'b', username: '', token: 'token-b', user: null },
		]);
	});

	test('tokenが無く情報キャッシュだけあるアカウントも拾う', () => {
		const entries = ledgerEntriesFromLegacy({
			accountTokens: {},
			accountInfos: { [`${HOST}/c`]: userOf('c', 'carol') },
		});
		expect(entries).toEqual([
			{ host: HOST, id: 'c', username: 'carol', token: null, user: userOf('c', 'carol') },
		]);
	});

	test('移行元が空なら空', () => {
		expect(ledgerEntriesFromLegacy({ accountTokens: {}, accountInfos: {} })).toEqual([]);
	});

	test('壊れたキーは無視する', () => {
		const entries = ledgerEntriesFromLegacy({
			accountTokens: { 'nohost': 't', [`${HOST}/`]: 't', [`/id`]: 't' },
			accountInfos: {},
		});
		expect(entries).toEqual([]);
	});
});

function legacyBridge(initial: { accountTokens?: Record<string, string>; accountInfos?: Record<string, Misskey.entities.MeDetailed> } = {}) {
	const state = {
		accountTokens: initial.accountTokens ?? {},
		accountInfos: initial.accountInfos ?? {},
	};
	const bridge: LegacyLedgerBridge & { state: typeof state; readCount: number } = {
		state,
		readCount: 0,
		read: async () => { bridge.readCount++; return state; },
		write: async (entries) => {
			const built = buildLegacyLedger(entries);
			state.accountTokens = built.accountTokens;
			state.accountInfos = built.accountInfos;
		},
	};
	return bridge;
}

describe('AccountLedger', () => {
	test('upsert / remove が永続化される', async () => {
		const kv = memoryKv();
		const ledger = new AccountLedger(kv);
		await ledger.ready;

		await ledger.upsertEntry(entry('a'));
		await ledger.upsertEntry(entry('b'));
		expect(ledger.listEntries().map(e => e.id)).toEqual(['a', 'b']);
		expect(ledger.getEntry(`${HOST}/a`)?.token).toBe('token-a');

		// 既存エントリは追加ではなく更新
		await ledger.upsertEntry(entry('a', { token: 'renewed', user: userOf('a', 'alice') }));
		expect(ledger.listEntries()).toHaveLength(2);
		expect(ledger.getEntry(`${HOST}/a`)?.token).toBe('renewed');
		expect(ledger.getEntry(`${HOST}/a`)?.user).toEqual(userOf('a', 'alice'));

		await ledger.removeEntry(`${HOST}/a`);
		expect(ledger.listEntries().map(e => e.id)).toEqual(['b']);
		expect(ledger.getEntry(`${HOST}/a`)).toBe(null);

		// 別インスタンスで読み直しても同じ
		const reloaded = new AccountLedger(kv);
		await reloaded.ready;
		expect(reloaded.listEntries().map(e => e.id)).toEqual(['b']);
	});

	test('プライマリの既定値と追従', async () => {
		const ledger = new AccountLedger(memoryKv());
		await ledger.ready;
		expect(ledger.getPrimaryAccountKey()).toBe(null);

		// 最初のエントリが自動でプライマリになる
		await ledger.upsertEntry(entry('a'));
		expect(ledger.getPrimaryAccountKey()).toBe(`${HOST}/a`);

		// 2つ目を足してもプライマリは動かない
		await ledger.upsertEntry(entry('b'));
		expect(ledger.getPrimaryAccountKey()).toBe(`${HOST}/a`);

		// プライマリでないものを消してもプライマリは動かない
		await ledger.removeEntry(`${HOST}/b`);
		expect(ledger.getPrimaryAccountKey()).toBe(`${HOST}/a`);

		// プライマリが消えたら残りの先頭へ
		await ledger.upsertEntry(entry('c'));
		await ledger.removeEntry(`${HOST}/a`);
		expect(ledger.getPrimaryAccountKey()).toBe(`${HOST}/c`);

		// 空になったらnull
		await ledger.removeEntry(`${HOST}/c`);
		expect(ledger.getPrimaryAccountKey()).toBe(null);
	});

	test('setPrimaryAccountKey は台帳に居るアカウントしか指せない', async () => {
		const ledger = new AccountLedger(memoryKv());
		await ledger.ready;
		await ledger.upsertEntry(entry('a'));
		await ledger.upsertEntry(entry('b'));

		await ledger.setPrimaryAccountKey(`${HOST}/b`);
		expect(ledger.getPrimaryAccountKey()).toBe(`${HOST}/b`);

		// 居ないアカウントを指そうとしたら既定の選択に落ちる
		await ledger.setPrimaryAccountKey(`${HOST}/zzz`);
		expect(ledger.getPrimaryAccountKey()).toBe(`${HOST}/a`);
	});

	test('旧台帳から移行し、以後は再移行しない（冪等）', async () => {
		const kv = memoryKv();
		const legacy = legacyBridge({
			accountTokens: { [`${HOST}/a`]: 'token-a' },
			accountInfos: { [`${HOST}/a`]: userOf('a', 'alice') },
		});

		const ledger = new AccountLedger(kv, legacy);
		await ledger.ready;

		expect(ledger.listEntries()).toEqual([
			{ host: HOST, id: 'a', username: 'alice', token: 'token-a', user: userOf('a', 'alice') },
		]);
		expect(ledger.getPrimaryAccountKey()).toBe(`${HOST}/a`);
		expect(kv.dump()[LEDGER_KEY].entries).toHaveLength(1);
		expect(legacy.readCount).toBe(1);

		// 同じKVから作り直しても移行は走らない
		const again = new AccountLedger(kv, legacy);
		await again.ready;
		expect(legacy.readCount).toBe(1);
		expect(again.listEntries().map(e => e.id)).toEqual(['a']);
	});

	test('移行元が空なら何もしない（新規ユーザー）', async () => {
		const kv = memoryKv();
		const ledger = new AccountLedger(kv, legacyBridge());
		await ledger.ready;

		expect(ledger.listEntries()).toEqual([]);
		expect(ledger.getPrimaryAccountKey()).toBe(null);
		// キー自体を作らない
		expect(kv.dump()[LEDGER_KEY]).toBeUndefined();
	});

	test('移行済みで空の台帳は再移行されない（全ログアウト後に旧データが蘇らない）', async () => {
		const kv = memoryKv({ [LEDGER_KEY]: { entries: [], primaryAccountKey: null } });
		const legacy = legacyBridge({ accountTokens: { [`${HOST}/a`]: 'token-a' }, accountInfos: {} });

		const ledger = new AccountLedger(kv, legacy);
		await ledger.ready;

		expect(ledger.listEntries()).toEqual([]);
		expect(legacy.readCount).toBe(0);
	});

	test('永続化に失敗しても旧データがメモリ上の台帳に載る（フォールバック）', async () => {
		const kv: LedgerKv = {
			get: async () => undefined,
			set: async () => { throw new Error('idb is dead'); },
		};
		const legacy = legacyBridge({ accountTokens: { [`${HOST}/a`]: 'token-a' }, accountInfos: {} });

		const ledger = new AccountLedger(kv, legacy);
		await ledger.ready;

		expect(ledger.listEntries().map(e => e.token)).toEqual(['token-a']);
	});

	test('旧台帳が読めなくてもbootを止めない', async () => {
		const legacy: LegacyLedgerBridge = {
			read: async () => { throw new Error('broken'); },
			write: async () => {},
		};
		const ledger = new AccountLedger(memoryKv(), legacy);
		await expect(ledger.ready).resolves.toBeUndefined();
		expect(ledger.listEntries()).toEqual([]);
	});

	test('移行期間中は旧台帳へもdual-writeされる', async () => {
		const legacy = legacyBridge();
		const ledger = new AccountLedger(memoryKv(), legacy);
		await ledger.ready;

		await ledger.upsertEntry(entry('a', { user: userOf('a', 'alice') }));
		await ledger.upsertEntry(entry('b', { token: null }));
		expect(legacy.state.accountTokens).toEqual({ [`${HOST}/a`]: 'token-a' });
		expect(legacy.state.accountInfos).toEqual({ [`${HOST}/a`]: userOf('a', 'alice') });

		await ledger.removeEntry(`${HOST}/a`);
		expect(legacy.state.accountTokens).toEqual({});
		expect(legacy.state.accountInfos).toEqual({});
	});
});

describe('legacy-ledger', () => {
	test('extractLegacyLedger は壊れた値を空として扱う', () => {
		expect(extractLegacyLedger(undefined)).toEqual({ accountTokens: {}, accountInfos: {} });
		expect(extractLegacyLedger({ accountTokens: 'x' })).toEqual({ accountTokens: {}, accountInfos: {} });
		expect(extractLegacyLedger({ accountTokens: { a: 't' } })).toEqual({ accountTokens: { a: 't' }, accountInfos: {} });
	});

	test('buildLegacyLedger は token / user が無いエントリを落とす', () => {
		expect(buildLegacyLedger([
			{ host: HOST, id: 'a', token: 'token-a', user: userOf('a', 'alice') },
			{ host: HOST, id: 'b', token: null, user: null },
		])).toEqual({
			accountTokens: { [`${HOST}/a`]: 'token-a' },
			accountInfos: { [`${HOST}/a`]: userOf('a', 'alice') },
		});
	});
});
