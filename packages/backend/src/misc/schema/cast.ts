/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isValibotSchema, unwrapPipe } from './bridge.js';
import type { AnyValibotSchema, EndpointSchema } from './bridge.js';

/** JSON でないリクエスト (GET クエリ / multipart) から受けた文字列をキャストすべき型 */
export type CastableType = 'boolean' | 'number' | 'integer';

const CASTABLE_TYPES: ReadonlySet<string> = new Set<CastableType>(['boolean', 'number', 'integer']);

/** optional / nullable 系ラッパーを剥がす */
const WRAPPER_TYPES: ReadonlySet<string> = new Set([
	'optional', 'exact_optional', 'nullable', 'nullish', 'undefinedable',
	'non_optional', 'non_nullable', 'non_nullish',
]);

/**
 * GET / multipart リクエストで `JSON.parse` によるキャストが必要なトップレベルパラメータを抽出する。
 *
 * 現行 [ApiCallService](../../server/api/ApiCallService.ts) の "Cast non JSON input" が
 * `ep.params.properties` を毎リクエスト内省していたのを、endpoint 構築時に 1 回で済ませるためのもの。
 *
 * トップレベルが object でない場合 (union など) は空を返す (現行も `properties` が無ければ何もしない)。
 */
export function getCastableParams(paramDef: EndpointSchema): Record<string, CastableType> {
	return isValibotSchema(paramDef)
		? getCastableParamsFromValibot(paramDef)
		: getCastableParamsFromLegacy(paramDef);
}

function getCastableParamsFromLegacy(paramDef: Exclude<EndpointSchema, AnyValibotSchema>): Record<string, CastableType> {
	const result: Record<string, CastableType> = {};
	if (paramDef.properties == null) return result;

	for (const [key, prop] of Object.entries(paramDef.properties)) {
		const type = prop.type ?? '';
		if (CASTABLE_TYPES.has(type)) result[key] = type as CastableType;
	}

	return result;
}

function getCastableParamsFromValibot(paramDef: AnyValibotSchema): Record<string, CastableType> {
	const result: Record<string, CastableType> = {};

	const { base } = unwrapPipe(paramDef);
	const entries = (base as unknown as { entries?: Record<string, AnyValibotSchema> }).entries;
	if (entries == null) return result;

	for (const [key, entry] of Object.entries(entries)) {
		const type = castableTypeOf(entry);
		if (type != null) result[key] = type;
	}

	return result;
}

function castableTypeOf(schema: AnyValibotSchema): CastableType | undefined {
	let { base, actions } = unwrapPipe(schema);

	// optional / nullable 系のラッパーを剥がしつつ、通過した pipe のアクションも集める
	while (WRAPPER_TYPES.has(base.type)) {
		const wrapped = (base as unknown as { wrapped?: AnyValibotSchema }).wrapped;
		if (wrapped == null) break;
		const unwrapped = unwrapPipe(wrapped);
		base = unwrapped.base;
		actions = [...actions, ...unwrapped.actions];
	}

	if (base.type === 'boolean') return 'boolean';

	if (base.type === 'number') {
		const isInteger = actions.some(action =>
			typeof action === 'object' && action !== null &&
			(action as { type?: unknown }).type === 'integer');
		return isInteger ? 'integer' : 'number';
	}

	return undefined;
}
