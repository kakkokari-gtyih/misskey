/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test } from 'vitest';
import type { AccountKey, ParsedStorageKey } from '@/lib/storage/keys.js';
import type { ErasureDeps, ErasureKv } from '@/accounts/erasure.js';
import type { LedgerEntry } from '@/accounts/ledger.js';
import {
	_setAccountErasureHooksForTesting,
	eraseAccountData,
	sensitiveNamesOf,
	shouldEraseLocalStorageKeyOnDeviceWipe,
	shouldEraseRawIdbKeyOnDeviceWipe,
	shouldKeepManagedKeyOnDeviceWipe,
	splitAccountKey,
	stripSensitiveFromDeviceBlob,
	wipeDevice,
} from '@/accounts/erasure.js';
import { pickNextAccountToken, shouldPromoteToFullLogout } from '@/accounts/logout-policy.js';
import { buildKey, parseKey } from '@/lib/storage/keys.js';

const HOST = 'example.com';
const ALICE: AccountKey = `${HOST}/alice`;
const BOB: AccountKey = `${HOST}/bob`;

const DEVICE_BASE = buildKey({ category: 'state', owner: { kind: 'device' }, name: 'base' });

function memoryKv(initial: Record<string, any> = {}) {
	const store = new Map<string, any>(Object.entries(initial));
	const kv: ErasureKv = {
		listRawKeys: async () => [...store.keys()],
		listManagedKeys: async () => {
			const out: ParsedStorageKey[] = [];
			for (const raw of store.keys()) {
				const parsed = parseKey(raw);
				if (parsed != null) out.push(parsed);
			}
			return out;
		},
		delMany: async (keys) => { for (const k of keys) store.delete(k); },
		get: async (key) => store.get(key),
		set: async (key, val) => { store.set(key, val); },
	};
	return { kv, store };
}

function memoryLocalStorage(initial: Record<string, string> = {}) {
	const map = new Map<string, string>(Object.entries(initial));
	return {
		map,
		ls: {
			get length() { return map.size; },
			key: (i: number) => [...map.keys()][i] ?? null,
			removeItem: (k: string) => { map.delete(k); },
		},
	};
}

function makeDeps(over: Partial<ErasureDeps> & { kv: ErasureKv }): ErasureDeps {
	return {
		localStorage: memoryLocalStorage().ls,
		clearAccountSettings: async () => {},
		removeFromRoster: async () => {},
		removeLedgerEntry: async () => {},
		sensitiveDeviceState: async () => new Map(),
		deleteLegacyDatabases: async () => {},
		...over,
	};
}

beforeEach(() => {
	_setAccountErasureHooksForTesting([]);
});

describe('splitAccountKey', () => {
	test('hostとidに割る', () => {
		expect(splitAccountKey(ALICE)).toEqual({ host: HOST, id: 'alice' });
	});

	test('idに"/"が含まれても最初の"/"で割る', () => {
		expect(splitAccountKey(`${HOST}/a/b` as AccountKey)).toEqual({ host: HOST, id: 'a/b' });
	});

	test('壊れたキーはnull', () => {
		expect(splitAccountKey('nohost' as AccountKey)).toBe(null);
		expect(splitAccountKey('/alice' as AccountKey)).toBe(null);
		expect(splitAccountKey(`${HOST}/` as AccountKey)).toBe(null);
	});
});

describe('shouldEraseLocalStorageKeyOnDeviceWipe', () => {
	test('persistent分類は残す', () => {
		for (const key of ['lang', 'colorScheme', 'neverShowDonationInfo', 'latestDonationInfoShownAt', 'neverShowLocalOnlyInfo', 'modifiedVersionMustProminentlyOfferInAgplV3Section13Read', 'ui:folder:foo']) {
			expect(shouldEraseLocalStorageKeyOnDeviceWipe(key), key).toBe(false);
		}
	});

	test('deviceWipe分類は消す', () => {
		for (const key of ['account', 'preferences', 'drafts', 'instance', 'theme', 'miux:foo', 'aiscript:bar']) {
			expect(shouldEraseLocalStorageKeyOnDeviceWipe(key), key).toBe(true);
		}
	});

	test('hidePreferencesRestoreSuggestionは消す（preferences本体が消えるので抑止フラグだけ残さない）', () => {
		expect(shouldEraseLocalStorageKeyOnDeviceWipe('hidePreferencesRestoreSuggestion')).toBe(true);
	});

	test('未知のキーは保守的に消す', () => {
		expect(shouldEraseLocalStorageKeyOnDeviceWipe('somethingUnknown')).toBe(true);
	});

	test('idbfallback::はlocalStorage側の掃除対象外（kv層の判定に委ねる）', () => {
		expect(shouldEraseLocalStorageKeyOnDeviceWipe(`idbfallback::${DEVICE_BASE}`)).toBe(false);
		expect(shouldEraseLocalStorageKeyOnDeviceWipe('idbfallback::mk::cache::device::whatever')).toBe(false);
	});
});

describe('shouldKeepManagedKeyOnDeviceWipe', () => {
	const keep = (raw: string) => shouldKeepManagedKeyOnDeviceWipe(parseKey(raw)!);

	test('state/deviceは残す', () => {
		expect(keep(DEVICE_BASE)).toBe(true);
	});

	test('stateでもアカウントスコープは消す', () => {
		expect(keep(buildKey({ category: 'state', owner: { kind: 'account', account: ALICE }, name: 'base' }))).toBe(false);
	});

	test('cacheとcredentialsは消す', () => {
		expect(keep(buildKey({ category: 'cache', owner: { kind: 'device' }, name: 'x' }))).toBe(false);
		expect(keep(buildKey({ category: 'cache', owner: { kind: 'account', account: ALICE }, name: 'registry-base' }))).toBe(false);
		expect(keep(buildKey({ category: 'credentials', owner: { kind: 'device' }, name: 'accounts' }))).toBe(false);
	});
});

describe('shouldEraseRawIdbKeyOnDeviceWipe', () => {
	test('state/deviceの生キーだけ残す', () => {
		expect(shouldEraseRawIdbKeyOnDeviceWipe(DEVICE_BASE)).toBe(false);
		expect(shouldEraseRawIdbKeyOnDeviceWipe(buildKey({ category: 'state', owner: { kind: 'device' }, name: 'meta-migration' }))).toBe(false);
	});

	test('管理下でも state/account・cache・credentials は消す', () => {
		expect(shouldEraseRawIdbKeyOnDeviceWipe(buildKey({ category: 'state', owner: { kind: 'account', account: ALICE }, name: 'base' }))).toBe(true);
		expect(shouldEraseRawIdbKeyOnDeviceWipe(buildKey({ category: 'cache', owner: { kind: 'device' }, name: 'x' }))).toBe(true);
		expect(shouldEraseRawIdbKeyOnDeviceWipe(buildKey({ category: 'credentials', owner: { kind: 'device' }, name: 'accounts' }))).toBe(true);
	});

	test('`mk::`管理外の未知キーは消す（token残留の退行を防ぐ）', () => {
		// 旧StateStoreのblob。accountTokens / accountInfos = 全アカウントのtokenを抱えている
		expect(shouldEraseRawIdbKeyOnDeviceWipe('pizzax::base')).toBe(true);
		expect(shouldEraseRawIdbKeyOnDeviceWipe('pizzax::base::someUserId')).toBe(true);
		// 超旧世代の `{ token, id }[]`
		expect(shouldEraseRawIdbKeyOnDeviceWipe('accounts')).toBe(true);
		expect(shouldEraseRawIdbKeyOnDeviceWipe('emojis')).toBe(true);
		expect(shouldEraseRawIdbKeyOnDeviceWipe('lastEmojisFetchedAt')).toBe(true);
		// 文法違反の`mk::`キーも管理外扱い
		expect(shouldEraseRawIdbKeyOnDeviceWipe('mk::bogus::device::x')).toBe(true);
	});
});

describe('stripSensitiveFromDeviceBlob', () => {
	test('指定キーだけを抜く', () => {
		expect(stripSensitiveFromDeviceBlob({ tips: { a: true }, recentlyUsedUsers: ['x'] }, ['recentlyUsedUsers']))
			.toEqual({ tips: { a: true } });
	});

	test('抜くものが無ければnull（無駄な書き戻しをしない）', () => {
		expect(stripSensitiveFromDeviceBlob({ tips: {} }, ['recentlyUsedUsers'])).toBe(null);
	});

	test('オブジェクトでなければnull', () => {
		expect(stripSensitiveFromDeviceBlob(undefined, ['a'])).toBe(null);
		expect(stripSensitiveFromDeviceBlob([1, 2], ['a'])).toBe(null);
	});
});

describe('sensitiveNamesOf', () => {
	test('where:deviceかつsensitive:trueのものだけ拾う', () => {
		expect(sensitiveNamesOf({
			tips: { where: 'device', default: {} },
			recentlyUsedUsers: { where: 'device', default: [], sensitive: true },
			// where:account / deviceAccount は元々アカウント単位で消えるので対象外
			memo: { where: 'account', default: null, sensitive: true },
			visibility: { where: 'deviceAccount', default: 'public', sensitive: true },
		})).toEqual(['recentlyUsedUsers']);
	});
});

describe('eraseAccountData', () => {
	test('対象アカウントのキーだけを消し、他アカウントとdeviceスコープは無傷', async () => {
		const { kv, store } = memoryKv({
			[DEVICE_BASE]: { tips: { a: true } },
			[buildKey({ category: 'state', owner: { kind: 'account', account: ALICE }, name: 'base' })]: { visibility: 'home' },
			[buildKey({ category: 'cache', owner: { kind: 'account', account: ALICE }, name: 'registry-base' })]: {},
			[buildKey({ category: 'state', owner: { kind: 'account', account: BOB }, name: 'base' })]: { visibility: 'public' },
			[buildKey({ category: 'cache', owner: { kind: 'account', account: BOB }, name: 'registry-deck' })]: {},
			[buildKey({ category: 'credentials', owner: { kind: 'device' }, name: 'accounts' })]: { entries: [] },
			'unmanaged-key': 'untouched',
		});

		const cleared: string[] = [];
		const removedFromRoster: string[] = [];
		const removedFromLedger: string[] = [];

		await eraseAccountData(ALICE, makeDeps({
			kv,
			clearAccountSettings: async (h, i) => { cleared.push(`${h}/${i}`); },
			removeFromRoster: async (h, i) => { removedFromRoster.push(`${h}/${i}`); },
			removeLedgerEntry: async (a) => { removedFromLedger.push(a); },
		}));

		expect([...store.keys()].sort()).toEqual([
			buildKey({ category: 'cache', owner: { kind: 'account', account: BOB }, name: 'registry-deck' }),
			buildKey({ category: 'credentials', owner: { kind: 'device' }, name: 'accounts' }),
			DEVICE_BASE,
			buildKey({ category: 'state', owner: { kind: 'account', account: BOB }, name: 'base' }),
			'unmanaged-key',
		].sort());

		expect(cleared).toEqual([ALICE]);
		expect(removedFromRoster).toEqual([ALICE]);
		expect(removedFromLedger).toEqual([ALICE]);
	});

	test('登録済みフックが呼ばれ、1つ失敗しても残りは続行する', async () => {
		const { kv } = memoryKv();
		const called: string[] = [];

		_setAccountErasureHooksForTesting([
			async () => { throw new Error('boom'); },
			async (a) => { called.push(a); },
		]);

		await eraseAccountData(ALICE, makeDeps({ kv }));

		expect(called).toEqual([ALICE]);
	});

	test('壊れたアカウントキーでは何もしない', async () => {
		const { kv, store } = memoryKv({ [DEVICE_BASE]: {} });
		await eraseAccountData('broken' as AccountKey, makeDeps({ kv }));
		expect([...store.keys()]).toEqual([DEVICE_BASE]);
	});
});

describe('wipeDevice', () => {
	test('state/deviceが残り、アカウントスコープ・cache・credentialsが消える', async () => {
		const { kv, store } = memoryKv({
			[DEVICE_BASE]: { tips: { a: true } },
			[buildKey({ category: 'state', owner: { kind: 'device' }, name: 'other' })]: { x: 1 },
			[buildKey({ category: 'state', owner: { kind: 'account', account: ALICE }, name: 'base' })]: {},
			[buildKey({ category: 'cache', owner: { kind: 'device' }, name: 'foo' })]: {},
			[buildKey({ category: 'cache', owner: { kind: 'account', account: ALICE }, name: 'registry-base' })]: {},
			[buildKey({ category: 'credentials', owner: { kind: 'device' }, name: 'accounts' })]: { entries: [] },
		});

		await wipeDevice(makeDeps({ kv }));

		expect([...store.keys()].sort()).toEqual([
			DEVICE_BASE,
			buildKey({ category: 'state', owner: { kind: 'device' }, name: 'other' }),
		].sort());
	});

	test('`mk::`管理外の旧キーも消える（develop の idb clear() からの退行を防ぐ）', async () => {
		const { kv, store } = memoryKv({
			[DEVICE_BASE]: { tips: { a: true } },
			// 旧StateStoreのblob。全アカウントのtokenを含む
			'pizzax::base': { accountTokens: { [ALICE]: 'tok-a', [BOB]: 'tok-b' }, accountInfos: {} },
			'pizzax::base::alice': { visibility: 'home' },
			// 超旧世代の台帳。これもtokenを含む
			accounts: [{ token: 'tok-a', id: 'alice' }],
			emojis: [],
			lastEmojisFetchedAt: 0,
		});

		await wipeDevice(makeDeps({ kv }));

		expect([...store.keys()]).toEqual([DEVICE_BASE]);
	});

	test('#16713: ヒントの既読(tips)がログアウト後も残る', async () => {
		const { kv, store } = memoryKv({
			[DEVICE_BASE]: { tips: { someTip: true }, recentlyUsedUsers: ['x'] },
		});

		await wipeDevice(makeDeps({
			kv,
			sensitiveDeviceState: async () => new Map([[DEVICE_BASE, ['recentlyUsedUsers']]]),
		}));

		expect(store.get(DEVICE_BASE)).toEqual({ tips: { someTip: true } });
	});

	test('sensitive指定のキーだけがblobから抜かれる', async () => {
		const { kv, store } = memoryKv({
			[DEVICE_BASE]: {
				tips: { a: true },
				recentlyUsedEmojis: ['👍'],
				recentlyUsedUsers: ['u1'],
				postFormHashtags: '#secret',
				accountTokens: { [ALICE]: 'tok' },
				accountInfos: { [ALICE]: {} },
			},
		});

		await wipeDevice(makeDeps({
			kv,
			sensitiveDeviceState: async () => new Map([[DEVICE_BASE, ['recentlyUsedUsers', 'postFormHashtags', 'accountTokens', 'accountInfos']]]),
		}));

		expect(store.get(DEVICE_BASE)).toEqual({ tips: { a: true }, recentlyUsedEmojis: ['👍'] });
	});

	test('localStorageはpersistentを残しdeviceWipeを消す。idbfallback::は触らない', async () => {
		const { kv } = memoryKv();
		const { ls, map } = memoryLocalStorage({
			lang: 'ja-JP',
			neverShowDonationInfo: 'true',
			'ui:folder:x': '1',
			account: '{}',
			drafts: '{}',
			theme: '{}',
			unknownThing: 'x',
			[`idbfallback::${DEVICE_BASE}`]: '{}',
			'idbfallback::mk::cache::device::foo': '{}',
		});

		await wipeDevice(makeDeps({ kv, localStorage: ls }));

		expect([...map.keys()].sort()).toEqual([
			'lang',
			'neverShowDonationInfo',
			'ui:folder:x',
			`idbfallback::${DEVICE_BASE}`,
			'idbfallback::mk::cache::device::foo',
		].sort());
	});

	test('レガシーDBの削除が呼ばれる', async () => {
		const { kv } = memoryKv();
		let called = false;
		await wipeDevice(makeDeps({ kv, deleteLegacyDatabases: async () => { called = true; } }));
		expect(called).toBe(true);
	});
});

describe('ログアウトの昇格判定', () => {
	function entry(id: string, over: Partial<LedgerEntry> = {}): LedgerEntry {
		return { host: HOST, id, username: id, token: `token-${id}`, user: null, ...over };
	}

	test('残りが0件なら全ログアウトへ昇格', () => {
		expect(shouldPromoteToFullLogout({ remaining: [], isCurrentAccount: true, host: HOST })).toBe(true);
		expect(shouldPromoteToFullLogout({ remaining: [], isCurrentAccount: false, host: HOST })).toBe(true);
	});

	test('現在のアカウントでも切替先があれば昇格しない', () => {
		expect(shouldPromoteToFullLogout({ remaining: [entry('bob')], isCurrentAccount: true, host: HOST })).toBe(false);
	});

	test('現在のアカウントで切替先のtokenが無ければ昇格', () => {
		expect(shouldPromoteToFullLogout({ remaining: [entry('bob', { token: null })], isCurrentAccount: true, host: HOST })).toBe(true);
	});

	test('外部ホストのアカウントしか残らない場合も昇格', () => {
		expect(shouldPromoteToFullLogout({ remaining: [entry('bob', { host: 'other.example' })], isCurrentAccount: true, host: HOST })).toBe(true);
	});

	test('他アカウントのログアウトは現在のセッションに影響しないので昇格しない', () => {
		expect(shouldPromoteToFullLogout({ remaining: [entry('bob', { token: null })], isCurrentAccount: false, host: HOST })).toBe(false);
	});

	test('pickNextAccountTokenはローカルホストでtokenを持つ先頭を選ぶ', () => {
		expect(pickNextAccountToken([entry('a', { token: null }), entry('b')], HOST)).toBe('token-b');
		expect(pickNextAccountToken([entry('a', { host: 'other.example' })], HOST)).toBe(null);
		expect(pickNextAccountToken([], HOST)).toBe(null);
	});
});
