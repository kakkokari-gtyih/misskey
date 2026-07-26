/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { deepClone } from '@/misc/clone.js';
import type { Schema } from '@/misc/json-schema.js';
import { refs } from '@/misc/json-schema.js';
import { isValibotSchema } from '@/misc/schema/bridge.js';
import { valibotToOpenApi } from '@/misc/schema/openapi.js';
import { getRegisteredEntities } from '@/misc/schema/registry.js';
import type { EndpointSchema } from '@/misc/schema/bridge.js';
import type { EntityName } from '@/misc/schema/metadata.js';

export function convertSchemaToOpenApiSchema(schema: Schema, type: 'param' | 'res', includeSelfRef: boolean): any {
	// optional, nullable, refはスキーマ定義に含まれないので分離しておく
	const { optional, nullable, ref, selfRef, ...res1 }: any = schema;
	const res = deepClone(res1);

	if (schema.type === 'object' && schema.properties) {
		if (type === 'res') {
			const required = Object.entries(schema.properties).filter(([k, v]) => !v.optional).map(([k]) => k);
			if (required.length > 0) {
			// 空配列は許可されない
				res.required = required;
			}
		}

		for (const k of Object.keys(schema.properties)) {
			res.properties[k] = convertSchemaToOpenApiSchema(schema.properties[k], type, includeSelfRef);
		}
	}

	if (schema.type === 'array' && schema.items) {
		res.items = convertSchemaToOpenApiSchema(schema.items, type, includeSelfRef);
	}

	for (const o of ['anyOf', 'oneOf', 'allOf'] as const) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		if (o in schema) res[o] = schema[o]!.map(schema => convertSchemaToOpenApiSchema(schema, type, includeSelfRef));
	}

	if (type === 'res' && schema.ref && (!schema.selfRef || includeSelfRef)) {
		const $ref = `#/components/schemas/${schema.ref}`;
		if (schema.nullable) {
			res.oneOf = [{ $ref }, { type: 'null' }];
		} else {
			res.$ref = $ref;
		}
		delete res.type;
	} else if (schema.nullable) {
		if (Array.isArray(schema.type) && !schema.type.includes('null')) {
			res.type.push('null');
		} else if (typeof schema.type === 'string') {
			res.type = [res.type, 'null'];
		}
	}

	return res;
}

/**
 * endpoint の `paramDef` / `meta.res` (legacy JSON Schema と Valibot が混在しうる) を
 * OpenAPI スキーマへ変換する。
 */
export function convertEndpointSchemaToOpenApi(schema: EndpointSchema, type: 'param' | 'res', includeSelfRef: boolean): any {
	if (isValibotSchema(schema)) {
		return valibotToOpenApi(schema, { use: type, includeSelfRef });
	}

	return convertSchemaToOpenApiSchema(schema, type, includeSelfRef);
}

/**
 * `components.schemas` の entity 部分を組み立てる。
 *
 * キー順は legacy {@link refs} の宣言順を正とし、Valibot 化済み entity は **同じキー位置で差し替える**
 * (移行しても api.json のキー順が動かないようにするため)。legacy `refs` から既に削除された
 * (= 完全に Valibot 化された) entity は末尾に登録順で並ぶ。
 *
 * NOTE: Valibot 側は `defineEntity()` の副作用で登録されるので、entity モジュールが
 * どこからも import されていないと `components.schemas` から漏れる。移行時は
 * `@/models/schema/` 配下のモジュールが (endpoint 経由で) 必ず読み込まれることを確認すること。
 */
function getEntitySchemas(includeSelfRef: boolean): Record<string, any> {
	const valibotEntities = getRegisteredEntities();
	const result: Record<string, any> = {};

	// NOTE: legacy `refs` は全 entity の Valibot 化完了により空 (= このループは現状 no-op)。
	// `refs` ごと消すのは PR-F の仕事なので、それまでは legacy 側の分岐を残しておく
	// (`{}` からは値の型が推論できないので `Schema` を明示する)。
	for (const [key, schema] of Object.entries<Schema>(refs)) {
		const valibotSchema = valibotEntities.get(key as EntityName);
		result[key] = valibotSchema != null
			? valibotToOpenApi(valibotSchema, { use: 'res', includeSelfRef, rootName: key })
			: convertSchemaToOpenApiSchema(schema, 'res', includeSelfRef);
	}

	for (const [key, schema] of valibotEntities) {
		if (Object.hasOwn(result, key)) continue;
		result[key] = valibotToOpenApi(schema, { use: 'res', includeSelfRef, rootName: key });
	}

	return result;
}

export function getSchemas(includeSelfRef: boolean) {
	return {
		Error: {
			type: 'object',
			properties: {
				error: {
					type: 'object',
					description: 'An error object.',
					properties: {
						code: {
							type: 'string',
							description: 'An error code. Unique within the endpoint.',
						},
						message: {
							type: 'string',
							description: 'An error message.',
						},
						id: {
							type: 'string',
							format: 'uuid',
							description: 'An error ID. This ID is static.',
						},
					},
					required: ['code', 'id', 'message'],
				},
			},
			required: ['error'],
		},

		...getEntitySchemas(includeSelfRef),
	};
}
