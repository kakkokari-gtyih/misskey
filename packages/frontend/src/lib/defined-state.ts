/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { customRef, ref, watch, onScopeDispose } from 'vue';
import type { Ref } from 'vue';
import { deepClone } from '@/utility/clone.js';

// 「定義オブジェクトから型を導出し、s / r / model() を生やす」部分だけを切り出した共通コア。
// StateStore（旧Pizzax）とPreferencesManagerは永続化モデルが全く違う（前者はwhereごとに素の値をidb/registryへ、
// 後者は[scope, value, meta]のレコード配列をプロファイルJSONへ）ため、継承ではなくコンポジションで使う。
// 永続化はcommitFnとして注入され、このクラス自身は一切ストレージを触らない。

/**
 * 定義オブジェクトの最小要件。
 * StateStoreのStateDefは`where`を、PREF_DEFは`accountDependent`等を追加で持つが、
 * 共通コアが関知するのは`default`だけ。
 */
export type AnyDefs = Record<string, { default: unknown }>;

/**
 * 定義レコードから設定値の型を導出する。
 * `default`がファクトリ関数の場合（PREF_DEFに存在する）はその戻り値型を採る。
 */
export type ValueOf<D> = D extends { default: infer V }
	? V extends (...args: any) => infer R ? R : V
	: never;

export type StateValues<Defs extends AnyDefs> = { [K in keyof Defs]: ValueOf<Defs[K]>; };
export type ReactiveValues<Defs extends AnyDefs> = { [K in keyof Defs]: Ref<ValueOf<Defs[K]>>; };

/** 値の変更を永続化する処理。呼び出し側（StateStore.set / PreferencesManager.commit）が注入する */
export type CommitFn<Defs extends AnyDefs> = <K extends keyof Defs>(key: K, value: ValueOf<Defs[K]>) => void;

/** s / r の初期値を決める処理。省略時はdefault（ファクトリなら呼んだ結果）のcloneが使われる */
export type InitialValueFn<Defs extends AnyDefs> = <K extends keyof Defs>(key: K) => ValueOf<Defs[K]>;

export class DefinedState<Defs extends AnyDefs> {
	public readonly defs: Defs;

	// TODO: これが実装されたらreadonlyにしたい: https://github.com/microsoft/TypeScript/issues/37487
	/**
	 * static / state の略 (static が予約語のため)
	 */
	public readonly s: StateValues<Defs>;

	/**
	 * reactive の略
	 */
	public readonly r: ReactiveValues<Defs>;

	private commitFn: CommitFn<Defs>;

	constructor(defs: Defs, commitFn: CommitFn<Defs>, initialValueOf?: InitialValueFn<Defs>) {
		this.defs = defs;
		this.commitFn = commitFn;

		this.s = {} as StateValues<Defs>;
		this.r = {} as ReactiveValues<Defs>;

		for (const _key in defs) {
			const key = _key as keyof Defs;
			// initialValueOfが与えられた場合は、返り値をそのまま使う（cloneしない）。
			// PreferencesManagerはプロファイル内のレコードの値と参照を共有することを前提にしているため。
			const value = initialValueOf != null ? initialValueOf(key) : DefinedState.initialValueFromDef(defs[key]);
			(this.s[key] as any) = value;
			(this.r[key] as Ref<any>) = ref(value);
		}
	}

	private static initialValueFromDef<D extends { default: unknown }>(def: D): ValueOf<D> {
		if (typeof def.default === 'function') { // factory
			return def.default() as ValueOf<D>;
		} else {
			// 参照渡しになるのを防ぐためclone
			return deepClone(def.default as any) as ValueOf<D>;
		}
	}

	/**
	 * 永続化を伴わずに s / r を書き換えます。
	 * 外部（クラウドやプロファイル）から降ってきた値をローカルへ反映する用途を想定。
	 */
	public rewrite<K extends keyof Defs>(key: K, value: ValueOf<Defs[K]>): void {
		const v = JSON.parse(JSON.stringify(value)); // deep copy 兼 vueのプロキシ解除
		this.r[key].value = (this.s[key] as any) = v;
	}

	/**
	 * 永続化を伴わずに s / r を書き換えます（値をコピーせずそのまま入れる）。
	 * 呼び出し側が既にコピー済みの生の値を持っている場合用。
	 */
	public rewriteRaw<K extends keyof Defs>(key: K, value: ValueOf<Defs[K]>): void {
		this.r[key].value = (this.s[key] as any) = value;
	}

	/**
	 * 特定のキーの、簡易的なcomputed refを作ります
	 * 主にvue上で設定コントロールのmodelとして使う用
	 */
	public model<K extends keyof Defs, V = ValueOf<Defs[K]>>(
		key: K,
	): Ref<V>;
	public model<K extends keyof Defs, V extends Exclude<any, ValueOf<Defs[K]>>>(
		key: K,
		getter: (v: ValueOf<Defs[K]>) => V,
		setter: (v: V) => ValueOf<Defs[K]>,
	): Ref<V>;

	public model<K extends keyof Defs, V>(
		key: K,
		getter?: (v: ValueOf<Defs[K]>) => V,
		setter?: (v: V) => ValueOf<Defs[K]>,
	): Ref<V> {
		return customRef<V>((track, trigger) => {
			const watchStop = watch(this.r[key], () => {
				trigger();
			});

			onScopeDispose(() => {
				watchStop();
			}, true);

			return {
				get: () => {
					track();
					return (getter != null ? getter(this.s[key]) : this.s[key]) as V;
				},
				set: (value) => {
					const val = setter != null ? setter(value) : value;
					this.commitFn(key, val as ValueOf<Defs[K]>);
				},
			};
		});
	}
}
