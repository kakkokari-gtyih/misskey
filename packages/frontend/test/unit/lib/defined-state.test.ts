/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { effectScope, isRef, nextTick } from 'vue';
import { DefinedState } from '@/lib/defined-state.js';

const DEFS = {
	num: { default: 42 as number },
	str: { default: 'hello' as string },
	obj: { default: { a: 1, b: { c: 2 } } as { a: number; b: { c: number }; } },
	arr: { default: [1, 2, 3] as number[] },
};

function create<T extends Record<string, { default: unknown }>>(defs: T) {
	const commits: [keyof T, unknown][] = [];
	const state = new DefinedState<T>(defs, (key, value) => {
		commits.push([key, value]);
		// 実インスタンス（StateStore.set / PreferencesManager.commit）と同様、永続化と同時にローカルへも反映する
		state.rewriteRaw(key, value);
	});
	return { state, commits };
}

describe('DefinedState', () => {
	test('定義からsとrが初期化される', () => {
		const { state } = create(DEFS);

		expect(state.s.num).toBe(42);
		expect(state.s.str).toBe('hello');
		expect(state.s.obj).toEqual({ a: 1, b: { c: 2 } });

		expect(isRef(state.r.num)).toBe(true);
		expect(state.r.num.value).toBe(42);
		expect(state.r.obj.value).toEqual({ a: 1, b: { c: 2 } });
	});

	test('defaultのオブジェクトが参照渡しにならない', () => {
		const defs = { obj: { default: { a: 1 } } };
		const a = new DefinedState(defs, () => {});
		const b = new DefinedState(defs, () => {});

		a.s.obj.a = 99;

		expect(b.s.obj.a).toBe(1);
		expect(defs.obj.default.a).toBe(1);
	});

	test('defaultがファクトリの場合は呼ばれる', () => {
		const factory = vi.fn(() => ({ generated: true }));
		const { state } = create({ x: { default: factory } });

		expect(factory).toHaveBeenCalledTimes(1);
		expect(state.s.x).toEqual({ generated: true });
		expect(state.r.x.value).toEqual({ generated: true });
	});

	test('initialValueOfで初期値を注入できる', () => {
		const state = new DefinedState(DEFS, () => {}, (key) => (`injected:${String(key)}` as never));

		expect(state.s.num).toBe('injected:num');
		expect(state.s.str).toBe('injected:str');
	});

	test('initialValueOfの返り値はcloneされず参照が共有される', () => {
		const source = { a: 1 };
		const state = new DefinedState({ obj: { default: {} } }, () => {}, () => source as never);

		expect(state.s.obj).toBe(source);
	});

	test('rewriteはsとrの両方を更新し、Vueのプロキシを解除する', () => {
		const { state, commits } = create(DEFS);

		// r経由で書き換えるとVueのリアクティブプロキシになる
		state.r.obj.value.a = 100;
		const proxied = state.r.obj.value;

		state.rewrite('obj', proxied);

		expect(state.s.obj).toEqual({ a: 100, b: { c: 2 } });
		expect(state.r.obj.value).toEqual({ a: 100, b: { c: 2 } });
		// プロキシそのものではなく、切り離されたプレーンオブジェクトが入っている
		expect(state.s.obj).not.toBe(proxied);
		// 永続化は伴わない
		expect(commits).toEqual([]);
	});

	test('rewriteRawは値をコピーせずそのまま入れる', () => {
		const { state } = create(DEFS);
		const value = { a: 9, b: { c: 9 } };

		state.rewriteRaw('obj', value);

		expect(state.s.obj).toBe(value);
	});

	describe('model', () => {
		test('getが現在値を返し、setがcommitFnを通る', () => {
			const { state, commits } = create(DEFS);
			const m = state.model('num');

			expect(m.value).toBe(42);

			m.value = 100;

			expect(commits).toEqual([['num', 100]]);
			expect(state.s.num).toBe(100);
			expect(m.value).toBe(100);
		});

		test('getter / setterによる変換が効く', () => {
			const { state, commits } = create(DEFS);
			const m = state.model('num', v => String(v), v => Number(v));

			expect(m.value).toBe('42');

			m.value = '7';

			expect(commits).toEqual([['num', 7]]);
			expect(state.s.num).toBe(7);
			expect(m.value).toBe('7');
		});

		test('rの変化でmodelが再評価される', async () => {
			const { state } = create(DEFS);
			const m = state.model('num');

			const seen: number[] = [];
			const scope = effectScope();
			scope.run(() => {
				// customRefのtrackを踏ませるため一度読む
				seen.push(m.value);
			});

			state.rewriteRaw('num', 5);
			await nextTick();

			expect(m.value).toBe(5);
			expect(seen).toEqual([42]);

			scope.stop();
		});
	});
});
