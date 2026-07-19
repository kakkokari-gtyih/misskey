/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { host } from '@@/js/config.js';
import type { PossiblyNonNormalizedPreferencesProfile, StorageProvider } from '@/preferences/manager.js';
import { PreferencesManager } from '@/preferences/manager.js';

const ACCOUNT = { id: 'aaaaaaaaaa' };
const OTHER_HOST = 'other.example.com';

/**
 * StorageProviderのインメモリ実装。
 * 実際のio (localStorage + registry API) には繋がず、保存内容だけを観測する。
 */
function memoryIo(initial: PossiblyNonNormalizedPreferencesProfile | null = null) {
	let stored = initial;
	const io: StorageProvider = {
		load: () => stored,
		save: vi.fn((ctx) => { stored = ctx.profile; }),
		cloudGetBulk: vi.fn(async () => ({})),
		cloudGet: vi.fn(async () => null),
		cloudSet: vi.fn(async () => {}),
	};
	return { io, dump: () => stored };
}

function profileWith(preferences: PossiblyNonNormalizedPreferencesProfile['preferences']): PossiblyNonNormalizedPreferencesProfile {
	return {
		id: 'test',
		version: '0.0.0',
		type: 'main',
		modifiedAt: 0,
		name: 'test',
		preferences,
	};
}

describe('PreferencesManager', () => {
	describe('getMatchedRecordOf (レコード解決順)', () => {
		test('アカウントスコープ > サーバースコープ > デフォルト の順で解決する', () => {
			const { io } = memoryIo(profileWith({
				serverDisconnectedBehavior: [
					[{}, 'default', {}],
					[{ server: host }, 'server', {}],
					[{ server: host, account: ACCOUNT.id }, 'account', {}],
				],
			}));
			const prefer = new PreferencesManager(io, ACCOUNT);

			expect(prefer.getMatchedRecordOf('serverDisconnectedBehavior')[1]).toBe('account');
			expect(prefer.s.serverDisconnectedBehavior).toBe('account');
		});

		test('アカウントスコープが無ければサーバースコープにフォールバックする', () => {
			const { io } = memoryIo(profileWith({
				serverDisconnectedBehavior: [
					[{}, 'default', {}],
					[{ server: host }, 'server', {}],
				],
			}));
			const prefer = new PreferencesManager(io, ACCOUNT);

			expect(prefer.getMatchedRecordOf('serverDisconnectedBehavior')[1]).toBe('server');
		});

		test('別サーバー・別アカウント宛のレコードは採用しない', () => {
			const { io } = memoryIo(profileWith({
				serverDisconnectedBehavior: [
					[{}, 'default', {}],
					[{ server: OTHER_HOST }, 'other-server', {}],
					[{ server: OTHER_HOST, account: ACCOUNT.id }, 'other-server-account', {}],
					[{ server: host, account: 'bbbbbbbbbb' }, 'other-account', {}],
				],
			}));
			const prefer = new PreferencesManager(io, ACCOUNT);

			expect(prefer.getMatchedRecordOf('serverDisconnectedBehavior')[1]).toBe('default');
		});

		test('未ログイン時はアカウント非依存のレコードのみ見る', () => {
			const { io } = memoryIo(profileWith({
				serverDisconnectedBehavior: [
					[{}, 'default', {}],
					[{ server: host, account: ACCOUNT.id }, 'account', {}],
				],
			}));
			const prefer = new PreferencesManager(io, null);

			expect(prefer.getMatchedRecordOf('serverDisconnectedBehavior')[1]).toBe('default');
		});
	});

	describe('normalizePreferences', () => {
		test('レコードが存在しないキーはデフォルト値のレコードで埋められる', () => {
			const { io } = memoryIo(null);
			const prefer = new PreferencesManager(io, null);

			// 通常のキー: アカウント非依存のレコードが1件だけ
			expect(prefer.profile.preferences.serverDisconnectedBehavior).toEqual([[{}, 'quiet', {}]]);
		});

		test('accountDependentなキーはログイン時にアカウントスコープのレコードも作られる', () => {
			const { io } = memoryIo(null);
			const prefer = new PreferencesManager(io, ACCOUNT);

			expect(prefer.profile.preferences.uploadFolder).toEqual([
				[{}, null, {}],
				[{ server: host, account: ACCOUNT.id }, null, {}],
			]);
		});

		test('accountDependentなキーでも未ログイン時はアカウントスコープを作らない', () => {
			const { io } = memoryIo(null);
			const prefer = new PreferencesManager(io, null);

			expect(prefer.profile.preferences.uploadFolder).toEqual([[{}, null, {}]]);
		});

		test('serverDependentなキーはサーバースコープのレコードとして作られる', () => {
			const { io } = memoryIo(null);
			const prefer = new PreferencesManager(io, ACCOUNT);

			expect(prefer.profile.preferences.emojiPaletteForReaction).toEqual([
				[{ server: host }, null, {}],
			]);
		});

		test('既存レコードにアカウントスコープが欠けていれば追加する', () => {
			const { io } = memoryIo(profileWith({
				uploadFolder: [[{}, 'folder-x', {}]],
			}));
			const prefer = new PreferencesManager(io, ACCOUNT);

			expect(prefer.profile.preferences.uploadFolder).toEqual([
				[{}, 'folder-x', {}],
				[{ server: host, account: ACCOUNT.id }, null, {}],
			]);
		});

		test('既存レコードがあれば値は保持される', () => {
			const { io } = memoryIo(profileWith({
				serverDisconnectedBehavior: [[{}, 'reload', {}]],
			}));
			const prefer = new PreferencesManager(io, ACCOUNT);

			expect(prefer.profile.preferences.serverDisconnectedBehavior).toEqual([[{}, 'reload', {}]]);
			expect(prefer.s.serverDisconnectedBehavior).toBe('reload');
		});

		test('PREF_DEFに無いキーは捨てられる', () => {
			const { io } = memoryIo(profileWith({
				thisKeyDoesNotExist: [[{}, 'x', {}]],
			}));
			const prefer = new PreferencesManager(io, null);

			expect(Object.hasOwn(prefer.profile.preferences, 'thisKeyDoesNotExist')).toBe(false);
		});

		test('normalizeで内容が変わった場合は保存される', () => {
			const { io } = memoryIo(null);
			new PreferencesManager(io, null);

			expect(io.save).toHaveBeenCalled();
		});
	});

	describe('commit', () => {
		test('s / r が更新され、レコードにも書き戻される', () => {
			const { io } = memoryIo(null);
			const prefer = new PreferencesManager(io, null);

			prefer.commit('serverDisconnectedBehavior', 'reload');

			expect(prefer.s.serverDisconnectedBehavior).toBe('reload');
			expect(prefer.r.serverDisconnectedBehavior.value).toBe('reload');
			expect(prefer.getMatchedRecordOf('serverDisconnectedBehavior')[1]).toBe('reload');
		});

		test('同じ値のcommitはスキップされcommittedも発火しない', () => {
			const { io } = memoryIo(null);
			const prefer = new PreferencesManager(io, null);

			const onCommitted = vi.fn();
			prefer.on('committed', onCommitted);

			prefer.commit('serverDisconnectedBehavior', prefer.s.serverDisconnectedBehavior);

			expect(onCommitted).not.toHaveBeenCalled();
		});

		test('committedイベントが発火する', () => {
			const { io } = memoryIo(null);
			const prefer = new PreferencesManager(io, null);

			const onCommitted = vi.fn();
			prefer.on('committed', onCommitted);

			prefer.commit('serverDisconnectedBehavior', 'reload');

			expect(onCommitted).toHaveBeenCalledTimes(1);
			expect(onCommitted.mock.calls[0][0].key).toBe('serverDisconnectedBehavior');
			expect(onCommitted.mock.calls[0][0].value).toBe('reload');
		});

		test('同期先が無くcloudSetが失敗してもローカルのcommitは成立する', async () => {
			const { io } = memoryIo(profileWith({
				// syncフラグが立った状態のレコード
				serverDisconnectedBehavior: [[{}, 'quiet', { sync: true }]],
			}));
			io.cloudSet = vi.fn(async () => { throw new Error('no primary account'); });
			const prefer = new PreferencesManager(io, null);

			prefer.commit('serverDisconnectedBehavior', 'reload');

			// 送信は試みるが、その失敗でcommitを巻き戻したり例外を漏らしたりしない
			expect(io.cloudSet).toHaveBeenCalledTimes(1);
			expect(prefer.s.serverDisconnectedBehavior).toBe('reload');

			// 未処理のPromise拒否になっていないこと
			await new Promise(resolve => setTimeout(resolve, 0));
		});

		test('model()経由のsetがcommitを通る', () => {
			const { io } = memoryIo(null);
			const prefer = new PreferencesManager(io, null);

			const m = prefer.model('serverDisconnectedBehavior');
			expect(m.value).toBe('quiet');

			m.value = 'reload';

			expect(prefer.s.serverDisconnectedBehavior).toBe('reload');
			expect(m.value).toBe('reload');
		});
	});
});
