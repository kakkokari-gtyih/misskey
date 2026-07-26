/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as v from 'valibot';
import type { Packed } from '@/misc/json-schema.js';
import { miMeta } from './metadata.js';
import { unwrapPipe } from './bridge.js';
import type { EntityName } from './metadata.js';
import type { AnyValibotSchema } from './bridge.js';

export type { EntityName };

/** name → schema。api.json の `components.schemas` を組み立てるのに使う */
const byName = new Map<EntityName, AnyValibotSchema>();

/**
 * schema → name。**逆引きで `$ref` を復元するための唯一の仕組み。**
 *
 * 「コード上はスキーマを直接 import、spec 上は `$ref`」を両立させるため、
 * 参照の同一性 (=== ) でレジストリ登録済み entity を検出する。
 */
const bySchema = new WeakMap<AnyValibotSchema, EntityName>();

/**
 * Valibot 版 packed スキーマを `#/components/schemas/<name>` として公開登録する。
 *
 * ```ts
 * export const packedFooSchema = defineEntity('Foo', v.object({ ... }));
 * export type PackedFoo = v.InferOutput<typeof packedFooSchema>;
 * ```
 */
export function defineEntity<const N extends EntityName, S extends AnyValibotSchema>(name: N, schema: S): S {
	const registered = byName.get(name);
	if (registered != null && registered !== schema) {
		throw new Error(`defineEntity: entity '${name}' is already registered with a different schema`);
	}

	byName.set(name, schema);
	bySchema.set(schema, name);

	return schema;
}

/**
 * スキーマオブジェクトから登録済み entity 名を逆引きする。未登録なら `undefined`。
 */
export function lookupEntityName(schema: unknown): EntityName | undefined {
	if (typeof schema !== 'object' || schema === null) return undefined;
	return bySchema.get(schema as AnyValibotSchema);
}

/** entity 名から登録済みスキーマを引く。未登録なら `undefined` */
export function resolveEntity(name: EntityName): AnyValibotSchema | undefined {
	return byName.get(name);
}

/** 登録済み entity の一覧 (登録順) */
export function getRegisteredEntities(): ReadonlyMap<EntityName, AnyValibotSchema> {
	return byName;
}

/**
 * **移行期間限定のつなぎ。** Valibot 化済み entity から、まだ legacy JSON Schema のままの
 * entity を参照するためのプレースホルダ。
 *
 * ランタイム検証は行わない (res のランタイム検証はスコープ外なので実害なし)。
 * OpenAPI 上は `{ $ref: '#/components/schemas/<name>' }` を出力する。
 *
 * 全 entity の移行完了後 (PR-F) にスキーマ直接 import へ置換して削除する。
 */
export function entityRef<const N extends EntityName>(name: N, opts: { selfRef?: boolean } = {}): v.GenericSchema<Packed<N>> {
	return v.pipe(
		v.custom<Packed<N>>(() => true),
		opts.selfRef === true ? miMeta({ ref: name, selfRef: true }) : miMeta({ ref: name }),
	);
}

type Flatten<T> = { [K in keyof T]: T[K] } & {};

type MergeTuple<T extends readonly unknown[]> =
	T extends readonly [infer H, ...infer R]
		? H & MergeTuple<R>
		: unknown;

/** {@link composeEntity} の入力型 (各パートの InferInput のマージ) */
export type ComposedInput<TParts extends readonly AnyValibotSchema[]> =
	Flatten<MergeTuple<{ [K in keyof TParts]: v.InferInput<TParts[K]> }>>;

/** {@link composeEntity} の出力型 (各パートの InferOutput のマージ) */
export type ComposedOutput<TParts extends readonly AnyValibotSchema[]> =
	Flatten<MergeTuple<{ [K in keyof TParts]: v.InferOutput<TParts[K]> }>>;

/**
 * legacy の `allOf` による entity 合成 (UserDetailedNotMe 等) の置き換え。
 *
 * - **ランタイム / 型**: 各パートの entries を spread マージしたフラットな `v.object`
 *   (`UnionToIntersection` ハック不要、型が速く読みやすい)
 * - **OpenAPI**: `allOfRefs` メタデータからコンバータが `allOf: [{ $ref }, ...]` を出力するので
 *   現行 api.json と差分ゼロ
 *
 * 各パートは {@link defineEntity} 済み (= `$ref` 可能) の object スキーマでなければならない。
 */
export function composeEntity<
	const N extends EntityName,
	const TParts extends readonly [AnyValibotSchema, ...AnyValibotSchema[]],
>(name: N, parts: TParts): v.GenericSchema<ComposedInput<TParts>, ComposedOutput<TParts>> {
	const allOfRefs: EntityName[] = [];
	const merged: Record<string, AnyValibotSchema> = {};

	for (const part of parts) {
		const refName = lookupEntityName(part);
		if (refName == null) {
			throw new Error(`composeEntity('${name}'): every part must be registered via defineEntity()`);
		}
		allOfRefs.push(refName);

		const { base } = unwrapPipe(part);
		const entries = (base as { entries?: Record<string, AnyValibotSchema> }).entries;
		if (entries == null) {
			throw new Error(`composeEntity('${name}'): part '${refName}' is not an object schema`);
		}

		Object.assign(merged, entries);
	}

	const schema = v.pipe(v.object(merged), miMeta({ allOfRefs: allOfRefs as readonly EntityName[] }));

	// NOTE: entries を動的にマージしているため v.object の推論は使えない。外向きの型は
	// ComposedInput / ComposedOutput で表現する (パート同士のキーは互いに素である前提)。
	return defineEntity(name, schema as unknown as v.GenericSchema<ComposedInput<TParts>, ComposedOutput<TParts>>);
}
