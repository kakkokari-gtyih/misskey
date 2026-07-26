/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Schema, SchemaType } from '@/misc/json-schema.js';
import type * as v from 'valibot';

/**
 * 任意の (同期) Valibot スキーマ。
 *
 * `v.GenericSchema` のエイリアス。パイプ済みスキーマ (`v.SchemaWithPipe`) もこれを満たす。
 */
export type AnyValibotSchema = v.GenericSchema;

/**
 * endpoint の `paramDef` / `meta.res` に指定できるスキーマ。
 *
 * 移行期間中は legacy の独自 JSON Schema と Valibot スキーマが混在する。
 */
export type EndpointSchema = Schema | AnyValibotSchema;

/**
 * スキーマの出力型 (= ハンドラが受け取る型 / レスポンスの型)。
 *
 * **必ず Valibot 側を先に評価すること。** legacy の {@link Schema} は全プロパティ optional な
 * interface なので、Valibot スキーマも構造的に `Schema` を満たしてしまう。
 */
export type SchemaOutput<S> =
	S extends AnyValibotSchema ? v.InferOutput<S> :
	S extends Schema ? SchemaType<S> :
	never;

/**
 * スキーマの入力型 (= クライアントが送ってよい型)。
 *
 * legacy 側は入出力を区別できないので出力型と同じものを返す。
 * ({@link SchemaOutput} と同じ理由で Valibot 側を先に評価する)
 */
export type SchemaInput<S> =
	S extends AnyValibotSchema ? v.InferInput<S> :
	S extends Schema ? SchemaType<S> :
	never;

/**
 * Valibot スキーマか否かを判別する。
 *
 * legacy の独自 JSON Schema はプレーンオブジェクトなので `kind` も `~standard` も持たない。
 */
export function isValibotSchema(x: unknown): x is AnyValibotSchema {
	return typeof x === 'object' && x !== null &&
		(x as { kind?: unknown }).kind === 'schema' &&
		'~standard' in x;
}

/**
 * `v.pipe()` を平坦化し、ベーススキーマとアクション列 (適用順) に分解する。
 *
 * `v.pipe(v.pipe(v.string(), a), b)` のような入れ子も `{ base: string, actions: [a, b] }` に正規化する。
 */
export function unwrapPipe(schema: AnyValibotSchema): { base: AnyValibotSchema, actions: readonly unknown[] } {
	const actions: unknown[] = [];
	let current = schema as AnyValibotSchema & { pipe?: readonly unknown[] };

	while (Array.isArray(current.pipe)) {
		const [first, ...rest] = current.pipe;
		actions.unshift(...rest);
		current = first as AnyValibotSchema & { pipe?: readonly unknown[] };
	}

	return { base: current, actions };
}

/**
 * pipe を剥がしたベーススキーマの `type` を返す。
 */
export function baseTypeOf(schema: AnyValibotSchema): string {
	return unwrapPipe(schema).base.type;
}

/** 値が「省略可能」であることを表すラッパー種別 (= OpenAPI の required から除外される) */
const ABSENTABLE_TYPES: ReadonlySet<string> = new Set(['optional', 'exact_optional', 'nullish', 'undefinedable']);

/** 値が null を許容するラッパー種別 */
const NULLABLE_TYPES: ReadonlySet<string> = new Set(['nullable', 'nullish']);

/**
 * `undefined` (キー欠落) を許容するスキーマか。object の `required` 導出に使う。
 */
export function allowsAbsent(schema: AnyValibotSchema): boolean {
	return ABSENTABLE_TYPES.has(baseTypeOf(schema));
}

/**
 * `res` が「空レスポンス (204) もありうる」ことを表しているか。
 *
 * legacy: `optional: true` または `nullable: true` / Valibot: optional / nullable / nullish ラッパー。
 *
 * 現行 [gen-spec.ts](../../server/api/openapi/gen-spec.ts) の
 * `res?.optional === true || res?.nullable === true` の置き換え。
 */
export function resAllowsEmpty(res: EndpointSchema | undefined | null): boolean {
	if (res == null) return false;

	if (isValibotSchema(res)) {
		const type = baseTypeOf(res);
		return ABSENTABLE_TYPES.has(type) || NULLABLE_TYPES.has(type);
	}

	return res.optional === true || res.nullable === true;
}
