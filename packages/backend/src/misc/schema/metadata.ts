/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as v from 'valibot';
import type { refs } from '@/misc/json-schema.js';
import type { valibotRefs } from '@/models/schema/_entities.js';

/**
 * OpenAPI (api.json) 上の `#/components/schemas/X` として公開される entity 名。
 *
 * 移行期間中は legacy の {@link refs} と Valibot 側の {@link valibotRefs} の和集合。
 * entity を移行すると `refs` からキーが消えて `valibotRefs` に移るので、両方を見る必要がある。
 * (PR-F で legacy レジストリを削除するタイミングで Valibot 側レジストリのキーだけになる)
 *
 * NOTE: `json-schema.ts` 側も `_entities.ts` を参照するが、いずれも type-only import なので
 * ランタイムの循環依存は発生しない。
 */
export type EntityName = keyof typeof refs | keyof typeof valibotRefs;

/**
 * `v.metadata()` に載せる Misskey 独自メタデータ。
 *
 * ランタイム検証には一切影響せず、{@link valibotToOpenApi} が OpenAPI キーワードへ変換するためだけに使う。
 *
 * NOTE: `interface` ではなく type alias にしているのは、`v.metadata()` の型制約
 * (`TMetadata extends Record<string, unknown>`) を満たすため (interface には implicit index signature が付かない)。
 */
export type MiMeta = {
	/** OpenAPI `format`。`'misskey:id'` / `'id'` / `'date-time'` / `'url'` など */
	readonly format?: string;
	/** OpenAPI `example` */
	readonly example?: unknown;
	/** OpenAPI `deprecated` */
	readonly deprecated?: boolean;
	/**
	 * 未移行 legacy entity への参照マーカー ({@link entityRef} が付ける)。
	 * res モードで `{ $ref: '#/components/schemas/<name>' }` として出力される。
	 */
	readonly ref?: EntityName;
	/**
	 * 自己参照マーカー (legacy の `selfRef: true` 相当)。
	 * `includeSelfRef === false` のとき `$ref` を出さず `{ type: 'object' }` に退化する。
	 */
	readonly selfRef?: boolean;
	/**
	 * allOf 合成マーカー ({@link composeEntity} が付ける)。
	 * これが付いた object は properties を出力せず `allOf: [{ $ref }, ...]` を出力する。
	 */
	readonly allOfRefs?: readonly EntityName[];
	/**
	 * `v.union` を OpenAPI 上どのキーワードで出すか。既定は `anyOf`。
	 * 現行 api.json が `oneOf` を出している箇所 (判別キーの無い oneOf) の互換用。
	 */
	readonly unionKeyword?: 'anyOf' | 'oneOf';
	/** 生の OpenAPI キーワードを最後にマージする (エスケープハッチ) */
	readonly openApi?: Readonly<Record<string, unknown>>;
	/** 出力から削除する OpenAPI キーワード (エスケープハッチ) */
	readonly omitKeywords?: readonly string[];
};

/**
 * 任意のスキーマの pipe に載せられる Misskey メタデータアクションを作る。
 *
 * NOTE: `TInput` は **呼び出し側の文脈から推論させる** (`v.pipe(v.string(), miMeta(...))` なら
 * `string`)。ここを `any` で固定すると `v.pipe()` の出力型 (= 最後の pipe item の型) が `any` に
 * 潰れてしまい、`misskeyId()` 等の型が失われる。文脈が無い場所では既定の `any` になり、
 * どのスキーマの pipe にも載せられる (メタデータは値を触らないので型安全性は落ちない)。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function miMeta<TInput = any, const T extends MiMeta = MiMeta>(meta: T): v.MetadataAction<TInput, T> {
	return v.metadata<any, T>(meta) as v.MetadataAction<TInput, T>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** OpenAPI `format` を付ける (ランタイム検証はしない) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function format<TInput = any>(value: string) {
	return miMeta<TInput, { readonly format: string }>({ format: value });
}

/**
 * OpenAPI `example` を付ける。
 *
 * cookbook R12 の `mi.example(v.string(), 'xxxxxxxxxx')` (スキーマをラップする形) と、
 * pipe に直接載せる `v.pipe(v.string(), example('xxxxxxxxxx'))` の両方をサポートする。
 */
export function example<TSchema extends v.GenericSchema>(schema: TSchema, value: unknown): TSchema;
export function example<TInput = any>(value: unknown): v.MetadataAction<TInput, { readonly example: unknown }>; // eslint-disable-line @typescript-eslint/no-explicit-any
export function example(a: unknown, ...rest: readonly unknown[]): unknown {
	if (rest.length === 0) return miMeta({ example: a });

	// NOTE: `v.pipe()` の戻り値 (SchemaWithPipe) は元スキーマのメンバーを全て持つので TSchema として扱える
	return v.pipe(a as v.GenericSchema, miMeta({ example: rest[0] }));
}

/** OpenAPI `deprecated: true` を付ける */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deprecated<TInput = any>() {
	return miMeta<TInput, { readonly deprecated: true }>({ deprecated: true });
}

/** legacy の `selfRef: true` 相当のマーカーを付ける */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function selfRef<TInput = any>() {
	return miMeta<TInput, { readonly selfRef: true }>({ selfRef: true });
}

/** `v.union` を `oneOf` として出力させる (判別キーの無い現行 oneOf の互換用) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asOneOf<TInput = any>() {
	return miMeta<TInput, { readonly unionKeyword: 'oneOf' }>({ unionKeyword: 'oneOf' });
}

/** 生の OpenAPI キーワードを注入する */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openApi<TInput = any>(raw: Readonly<Record<string, unknown>>) {
	return miMeta<TInput, { readonly openApi: Readonly<Record<string, unknown>> }>({ openApi: raw });
}

/** 出力から OpenAPI キーワードを削除する */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function omitKeywords<TInput = any>(...keys: readonly string[]) {
	return miMeta<TInput, { readonly omitKeywords: readonly string[] }>({ omitKeywords: keys });
}

/**
 * OpenAPI 変換時に無視される validation アクションであることを示すマーカー。
 *
 * 例: `misskeyId()` の regex は AJV の `format: 'misskey:id'` と等価なので、
 * OpenAPI 上は `format` だけを出し `pattern` は出さない (現行 api.json と一致させる)。
 */
export const OPENAPI_SKIP: unique symbol = Symbol('misskey:openApiSkip');

/** アクションを OpenAPI 変換の対象外にする */
export function skipInOpenApi<T extends object>(action: T): T {
	return Object.assign(action, { [OPENAPI_SKIP]: true as const });
}

/** {@link skipInOpenApi} が付いているか */
export function isSkippedInOpenApi(action: unknown): boolean {
	return typeof action === 'object' && action !== null && (action as Record<symbol, unknown>)[OPENAPI_SKIP] === true;
}

/** description / title は valibot 標準のメタデータアクションから拾う */
export type CollectedMetadata = MiMeta & {
	readonly description?: string;
	readonly title?: string;
};

/**
 * pipe 上のメタデータアクション列を 1 つの {@link CollectedMetadata} にマージする (後勝ち)。
 */
export function mergeMetadata(actions: readonly unknown[]): CollectedMetadata {
	const merged: Record<string, unknown> = {};

	for (const action of actions) {
		if (typeof action !== 'object' || action === null) continue;
		const a = action as { kind?: unknown; type?: unknown; metadata?: unknown; description?: unknown; title?: unknown };
		if (a.kind !== 'metadata') continue;

		if (a.type === 'metadata' && typeof a.metadata === 'object' && a.metadata !== null) {
			Object.assign(merged, a.metadata);
		} else if (a.type === 'description') {
			merged.description = a.description;
		} else if (a.type === 'title') {
			merged.title = a.title;
		}
	}

	return merged as CollectedMetadata;
}
