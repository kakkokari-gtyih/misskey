/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import {
	PreferencesTransport,
	PreferencesTransportUnavailableError,
	isAuthenticationFailure,
	isTransportUnavailable,
} from '@/preferences/transport.js';

const AUTHENTICATION_FAILED = { code: 'AUTHENTICATION_FAILED', id: 'b0a7f5f8-dc2f-4171-b91f-de88ad238e14' };

type Call = { endpoint: string; data: Record<string, any>; token: string };

/**
 * 台帳とAPIをインメモリに差し替えた輸送層。
 * 「どのtokenで送信されたか」を観測できるようにしてある。
 */
function setup(options: {
	primaryToken?: string | null;
	ready?: Promise<void>;
	respond?: (call: Call) => Promise<any>;
} = {}) {
	const calls: Call[] = [];
	let primaryToken: string | null = options.primaryToken ?? null;
	const onSuspend = vi.fn();

	const transport = new PreferencesTransport({
		ready: options.ready ?? Promise.resolve(),
		getPrimaryToken: () => primaryToken,
		api: async (endpoint, data, token) => {
			const call = { endpoint, data, token };
			calls.push(call);
			return options.respond != null ? options.respond(call) : { ok: true };
		},
		onSuspend,
	});

	return {
		transport,
		calls,
		onSuspend,
		setPrimaryToken: (token: string | null) => { primaryToken = token; },
	};
}

describe('PreferencesTransport', () => {
	describe('プライマリアカウントのtokenが使われる', () => {
		test('リクエストはプライマリのtokenで送信される', async () => {
			const { transport, calls } = setup({ primaryToken: 'token-primary' });

			await transport.request('i/registry/set', {
				scope: ['client', 'preferences', 'sync'],
				key: 'default:foo',
				value: [],
			});

			expect(calls).toHaveLength(1);
			expect(calls[0].token).toBe('token-primary');
			expect(calls[0].endpoint).toBe('i/registry/set');
		});

		test('プライマリを切り替えると以後の書き込みは新しい保存先へ行く', async () => {
			const { transport, calls, setPrimaryToken } = setup({ primaryToken: 'token-old' });

			await transport.request('i/registry/set', { scope: ['client'], key: 'a', value: 1 });

			setPrimaryToken('token-new');
			await transport.request('i/registry/set', { scope: ['client'], key: 'b', value: 2 });

			expect(calls.map(c => c.token)).toEqual(['token-old', 'token-new']);
		});

		test('操作アカウントに関係なく毎回台帳から引き直す', async () => {
			const getPrimaryToken = vi.fn(() => 'token-primary');
			const transport = new PreferencesTransport({
				ready: Promise.resolve(),
				getPrimaryToken,
				api: async () => ({}),
			});

			await transport.request('i/registry/keys', { scope: ['client'] });
			await transport.request('i/registry/keys', { scope: ['client'] });

			expect(getPrimaryToken).toHaveBeenCalledTimes(2);
		});
	});

	describe('プライマリが無いとき', () => {
		test('同期・バックアップは行われず、値が無いのとは区別できる形で失敗する', async () => {
			const { transport, calls } = setup({ primaryToken: null });

			const err = await transport.request('i/registry/get', { scope: ['client'], key: 'a' }).catch(e => e);

			// nullを返すと「クラウドに値が無い」と混同されるので必ず例外
			expect(err).toBeInstanceOf(PreferencesTransportUnavailableError);
			expect(isTransportUnavailable(err)).toBe(true);
			expect(err.reason).toBe('noPrimaryAccount');
			// 現在のアカウントへのフォールバックもしない = APIは一切叩かれない
			expect(calls).toHaveLength(0);
		});

		test('getAvailability が理由を返す', async () => {
			const { transport } = setup({ primaryToken: null });

			expect(await transport.getAvailability()).toEqual({ available: false, reason: 'noPrimaryAccount' });
			expect(await transport.isAvailable()).toBe(false);
		});

		test('プライマリが設定されれば利用可能になる', async () => {
			const { transport, setPrimaryToken } = setup({ primaryToken: null });

			expect(await transport.isAvailable()).toBe(false);

			setPrimaryToken('token-primary');

			expect(await transport.isAvailable()).toBe(true);
			expect(await transport.getAvailability()).toEqual({ available: true });
		});
	});

	describe('台帳のロード完了(ledgerReady)を待つ', () => {
		test('台帳のロード前にプライマリを引いて「未設定」と誤認しない', async () => {
			let resolveReady!: () => void;
			const ready = new Promise<void>(resolve => { resolveReady = resolve; });

			// 台帳のロードが終わるまではtokenを引けない、という実際の状況を再現する
			const { transport, calls, setPrimaryToken } = setup({ primaryToken: null, ready });

			const promise = transport.request('i/registry/get', { scope: ['client'], key: 'a' });

			// まだ待っている（ここで解決してしまうと noPrimaryAccount で失敗してしまう）
			expect(calls).toHaveLength(0);

			setPrimaryToken('token-primary');
			resolveReady();

			await promise;

			expect(calls).toHaveLength(1);
			expect(calls[0].token).toBe('token-primary');
		});

		test('isAvailable もロード完了を待つ', async () => {
			let resolveReady!: () => void;
			const ready = new Promise<void>(resolve => { resolveReady = resolve; });
			const { transport, setPrimaryToken } = setup({ primaryToken: null, ready });

			const promise = transport.isAvailable();

			setPrimaryToken('token-primary');
			resolveReady();

			expect(await promise).toBe(true);
		});
	});

	describe('プライマリのtokenが失効したとき', () => {
		test('認証エラーで一時停止し、以後リクエストを送らない', async () => {
			const { transport, calls } = setup({
				primaryToken: 'token-revoked',
				respond: async () => { throw AUTHENTICATION_FAILED; },
			});

			const err = await transport.request('i/registry/set', { scope: ['client'], key: 'a', value: 1 }).catch(e => e);
			expect(isTransportUnavailable(err)).toBe(true);
			expect(err.reason).toBe('suspended');
			expect(transport.suspended.value).toBe(true);

			// 2回目以降はAPIを叩かずに即座に失敗する（静かに失敗し続けない）
			const err2 = await transport.request('i/registry/set', { scope: ['client'], key: 'b', value: 2 }).catch(e => e);
			expect(err2.reason).toBe('suspended');
			expect(calls).toHaveLength(1);
		});

		test('通知は1度きり（毎回ダイアログを出さない）', async () => {
			const { transport, onSuspend } = setup({
				primaryToken: 'token-revoked',
				respond: async () => { throw AUTHENTICATION_FAILED; },
			});

			await transport.request('i/registry/set', { scope: ['client'], key: 'a', value: 1 }).catch(() => {});
			await transport.request('i/registry/set', { scope: ['client'], key: 'b', value: 2 }).catch(() => {});
			await transport.request('i/registry/set', { scope: ['client'], key: 'c', value: 3 }).catch(() => {});

			expect(onSuspend).toHaveBeenCalledTimes(1);
		});

		test('保存先を選び直すと自動的に再開する（呼び出し側のresume忘れに依存しない）', async () => {
			const { transport, calls, setPrimaryToken } = setup({
				primaryToken: 'token-revoked',
				respond: async (call) => {
					if (call.token === 'token-revoked') throw AUTHENTICATION_FAILED;
					return { ok: true };
				},
			});

			await transport.request('i/registry/set', { scope: ['client'], key: 'a', value: 1 }).catch(() => {});
			expect(transport.suspended.value).toBe(true);

			// プライマリを差し替えるだけでよい（明示的なresume()は不要）
			setPrimaryToken('token-new');

			await transport.request('i/registry/set', { scope: ['client'], key: 'b', value: 2 });

			expect(transport.suspended.value).toBe(false);
			expect(calls.map(c => c.token)).toEqual(['token-revoked', 'token-new']);
		});

		test('同じアカウントにログインし直してtokenが変わった場合も再開する', async () => {
			const { transport, setPrimaryToken } = setup({
				primaryToken: 'token-revoked',
				respond: async (call) => {
					if (call.token === 'token-revoked') throw AUTHENTICATION_FAILED;
					return { ok: true };
				},
			});

			await transport.request('i/registry/keys', { scope: ['client'] }).catch(() => {});
			expect(await transport.isAvailable()).toBe(false);

			setPrimaryToken('token-renewed');

			expect(await transport.isAvailable()).toBe(true);
		});

		test('tokenが変わらないうちは一時停止を維持する', async () => {
			const { transport } = setup({
				primaryToken: 'token-revoked',
				respond: async () => { throw AUTHENTICATION_FAILED; },
			});

			await transport.request('i/registry/keys', { scope: ['client'] }).catch(() => {});

			expect(await transport.getAvailability()).toEqual({ available: false, reason: 'suspended' });
			expect(await transport.getAvailability()).toEqual({ available: false, reason: 'suspended' });
		});

		test('resume() で明示的にも再開できる', async () => {
			const { transport } = setup({
				primaryToken: 'token-revoked',
				respond: async () => { throw AUTHENTICATION_FAILED; },
			});

			await transport.request('i/registry/keys', { scope: ['client'] }).catch(() => {});
			expect(transport.suspended.value).toBe(true);

			transport.resume();

			expect(transport.suspended.value).toBe(false);
		});

		test('一時停止中は理由付きで利用不可を返す', async () => {
			const { transport } = setup({
				primaryToken: 'token-revoked',
				respond: async () => { throw AUTHENTICATION_FAILED; },
			});

			await transport.request('i/registry/set', { scope: ['client'], key: 'a', value: 1 }).catch(() => {});

			expect(await transport.getAvailability()).toEqual({ available: false, reason: 'suspended' });
		});
	});

	describe('認証エラー以外は一時停止しない', () => {
		test('通信断や一時的なサーバーエラーではそのまま送出する', async () => {
			const fail = { code: 'INTERNAL_ERROR', id: 'x' };
			const { transport, onSuspend } = setup({
				primaryToken: 'token-primary',
				respond: async () => { throw fail; },
			});

			await expect(transport.request('i/registry/set', { scope: ['client'], key: 'a', value: 1 })).rejects.toBe(fail);
			expect(transport.suspended.value).toBe(false);
			expect(onSuspend).not.toHaveBeenCalled();
		});

		test('NO_SUCH_KEY は呼び出し側が「値が無い」と解釈できるようそのまま通す', async () => {
			const noSuchKey = { code: 'NO_SUCH_KEY', id: 'y' };
			const { transport } = setup({
				primaryToken: 'token-primary',
				respond: async () => { throw noSuchKey; },
			});

			await expect(transport.request('i/registry/get', { scope: ['client'], key: 'a' })).rejects.toBe(noSuchKey);
			expect(transport.suspended.value).toBe(false);
		});
	});
});

describe('isAuthenticationFailure', () => {
	test('tokenが失効している系のエラーだけを拾う', () => {
		expect(isAuthenticationFailure(AUTHENTICATION_FAILED)).toBe(true);
		expect(isAuthenticationFailure({ code: 'AUTHENTICATION_FAILED' })).toBe(true);
		expect(isAuthenticationFailure({ code: 'CREDENTIAL_REQUIRED' })).toBe(true);
	});

	test('一時的な失敗は含めない（同期を止めてしまわないため）', () => {
		expect(isAuthenticationFailure({ code: 'INTERNAL_ERROR' })).toBe(false);
		expect(isAuthenticationFailure({ code: 'RATE_LIMIT_EXCEEDED' })).toBe(false);
		expect(isAuthenticationFailure(new Error('network error'))).toBe(false);
		expect(isAuthenticationFailure(null)).toBe(false);
		expect(isAuthenticationFailure(undefined)).toBe(false);
		expect(isAuthenticationFailure('AUTHENTICATION_FAILED')).toBe(false);
	});
});
