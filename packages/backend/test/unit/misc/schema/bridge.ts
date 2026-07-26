/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import {
	baseTypeOf,
	composeEntity,
	defineEntity,
	entityRef,
	formatValibotIssues,
	getCastableParams,
	idString,
	integer,
	isValibotSchema,
	limit,
	lookupEntityName,
	maxCodePoints,
	mergeMetadata,
	misskeyId,
	resAllowsEmpty,
	resolveEntity,
	toInvalidParamInfo,
	unwrapPipe,
} from '@/misc/schema/index.js';
import type { Schema } from '@/misc/json-schema.js';
import type { SchemaInput, SchemaOutput } from '@/misc/schema/index.js';

describe('misc/schema:bridge', () => {
	describe('isValibotSchema()', () => {
		test('Valibot スキーマを判別する', () => {
			expect(isValibotSchema(v.string())).toBe(true);
			expect(isValibotSchema(v.object({ a: v.string() }))).toBe(true);
			expect(isValibotSchema(v.pipe(v.string(), maxCodePoints(1)))).toBe(true);
			expect(isValibotSchema(v.optional(v.string()))).toBe(true);
		});

		test('legacy JSON Schema / アクション / その他は false', () => {
			// entity 移行の進行に依存しないよう、legacy スキーマは refs からではなくリテラルで与える
			const legacySchema = {
				type: 'object',
				properties: {
					id: { type: 'string', optional: false, nullable: false, format: 'id' },
				},
			} as const satisfies Schema;
			expect(isValibotSchema(legacySchema)).toBe(false);
			expect(isValibotSchema({ type: 'object', properties: {} })).toBe(false);
			expect(isValibotSchema(maxCodePoints(1))).toBe(false);
			expect(isValibotSchema(null)).toBe(false);
			expect(isValibotSchema(undefined)).toBe(false);
			expect(isValibotSchema('string')).toBe(false);
		});
	});

	describe('unwrapPipe() / baseTypeOf()', () => {
		test('入れ子の pipe を平坦化しアクションを適用順に並べる', () => {
			const { base, actions } = unwrapPipe(v.pipe(v.pipe(v.string(), v.minLength(1)), v.maxLength(2)));
			expect(base.type).toBe('string');
			expect(actions.map(a => (a as { type: string }).type)).toStrictEqual(['min_length', 'max_length']);
		});

		test('baseTypeOf は pipe を剥がした type を返す', () => {
			expect(baseTypeOf(misskeyId())).toBe('string');
			expect(baseTypeOf(integer())).toBe('number');
			expect(baseTypeOf(v.optional(v.string()))).toBe('optional');
		});
	});

	describe('resAllowsEmpty()', () => {
		test('Valibot: optional / nullable / nullish は空レスポンスを許す', () => {
			expect(resAllowsEmpty(v.optional(v.string()))).toBe(true);
			expect(resAllowsEmpty(v.nullable(v.string()))).toBe(true);
			expect(resAllowsEmpty(v.nullish(v.string()))).toBe(true);
			expect(resAllowsEmpty(v.string())).toBe(false);
			expect(resAllowsEmpty(v.object({ a: v.optional(v.string()) }))).toBe(false);
		});

		test('legacy: optional / nullable フラグを見る', () => {
			expect(resAllowsEmpty({ type: 'string', optional: true })).toBe(true);
			expect(resAllowsEmpty({ type: 'string', nullable: true })).toBe(true);
			expect(resAllowsEmpty({ type: 'string' })).toBe(false);
		});

		test('res 未定義なら false', () => {
			expect(resAllowsEmpty(undefined)).toBe(false);
			expect(resAllowsEmpty(null)).toBe(false);
		});
	});

	describe('SchemaOutput / SchemaInput (型レベル)', () => {
		test('Valibot 側が先に評価され入出力が分離される', () => {
			const paramDef = v.object({
				limit: limit({ max: 100, def: 10 }),
				text: v.optional(v.string()),
			});

			// 出力型では default 付きキーが必須になる
			const output: SchemaOutput<typeof paramDef> = { limit: 10 };
			// 入力型では default 付きキーは省略できる
			const input: SchemaInput<typeof paramDef> = {};

			expect(v.parse(paramDef, input)).toStrictEqual(output);
		});

		test('legacy スキーマは SchemaType 経由で解決される', () => {
			const legacy = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } as const;
			const value: SchemaOutput<typeof legacy> = { a: 'x' };
			expect(Object.keys(legacy.properties)).toStrictEqual(Object.keys(value));
		});
	});
});

describe('misc/schema:registry', () => {
	test('defineEntity / lookupEntityName / resolveEntity', () => {
		const schema = defineEntity('Hashtag', v.object({ tag: v.string() }));

		expect(lookupEntityName(schema)).toBe('Hashtag');
		expect(resolveEntity('Hashtag')).toBe(schema);
		expect(lookupEntityName(v.object({ tag: v.string() }))).toBeUndefined();
		expect(resolveEntity('Note')).toBeUndefined();
		expect(lookupEntityName(null)).toBeUndefined();
	});

	test('同名で別スキーマを登録すると throw する', () => {
		defineEntity('Ad', v.object({ id: idString() }));
		expect(() => defineEntity('Ad', v.object({ id: idString() }))).toThrow(/already registered/);
	});

	test('同一スキーマの再登録は冪等', () => {
		const schema = v.object({ id: idString() });
		expect(defineEntity('App', schema)).toBe(schema);
		expect(defineEntity('App', schema)).toBe(schema);
	});

	test('entityRef() はランタイム検証をせず何でも通す (res 検証はスコープ外)', () => {
		const ref = entityRef('Note');
		expect(v.safeParse(ref, { anything: true }).success).toBe(true);
		expect(lookupEntityName(ref)).toBeUndefined();
	});

	describe('composeEntity()', () => {
		const lite = defineEntity('UserLite', v.object({ id: idString(), name: v.nullable(v.string()) }));
		const detailedOnly = defineEntity('UserDetailedNotMeOnly', v.object({ isFollowing: v.optional(v.boolean()) }));

		test('entries をフラットにマージして登録する', () => {
			const composed = composeEntity('UserDetailedNotMe', [lite, detailedOnly]);

			expect(lookupEntityName(composed)).toBe('UserDetailedNotMe');
			const { base } = unwrapPipe(composed);
			expect(Object.keys((base as unknown as { entries: object }).entries))
				.toStrictEqual(['id', 'name', 'isFollowing']);

			// ランタイムはフラットな object として振る舞う
			expect(v.safeParse(composed, { id: 'abc', name: null }).success).toBe(true);
			expect(v.safeParse(composed, { id: 'abc' }).success).toBe(false);
		});

		test('未登録スキーマもパートにできる (allOfParts はスキーマ本体を保持する)', () => {
			// legacy の Role のような「ref + inline properties 混在の allOf」に対応するための拡張
			const inline = v.object({ x: v.string() });
			const composed = composeEntity('MeDetailed', [lite, inline]);

			const { base, actions } = unwrapPipe(composed);
			expect(Object.keys((base as unknown as { entries: object }).entries))
				.toStrictEqual(['id', 'name', 'x']);
			// 登録済みパートは名前、未登録パートはスキーマ本体で保持される
			expect(mergeMetadata(actions).allOfParts).toStrictEqual(['UserLite', inline]);

			expect(v.safeParse(composed, { id: 'abc', name: null, x: 'y' }).success).toBe(true);
			expect(v.safeParse(composed, { id: 'abc', name: null }).success).toBe(false);
		});

		test('object でないパートを渡すと throw する', () => {
			const notObject = defineEntity('AchievementName', v.string());
			expect(() => composeEntity('MeDetailedOnly', [lite, notObject]))
				.toThrow(/is not an object schema/);
		});
	});
});

describe('misc/schema:cast', () => {
	test('Valibot: boolean / number / integer を抽出する', () => {
		const paramDef = v.object({
			limit: limit({ max: 100, def: 10 }),
			userId: misskeyId(),
			withFiles: v.optional(v.boolean(), false),
			ratio: v.optional(v.number()),
			tags: v.optional(v.array(v.string())),
		});

		expect(getCastableParams(paramDef)).toStrictEqual({
			limit: 'integer',
			withFiles: 'boolean',
			ratio: 'number',
		});
	});

	test('Valibot: optional / nullable / nullish を剥がして判定する', () => {
		expect(getCastableParams(v.object({
			a: v.nullable(v.boolean()),
			b: v.nullish(integer()),
			c: v.optional(v.nullable(v.number())),
		}))).toStrictEqual({ a: 'boolean', b: 'integer', c: 'number' });
	});

	test('Valibot: トップレベルが object でなければ空', () => {
		expect(getCastableParams(v.union([v.object({ a: v.boolean() })]))).toStrictEqual({});
		expect(getCastableParams(v.string())).toStrictEqual({});
	});

	test('legacy: 現行 ApiCallService と同一判定', () => {
		expect(getCastableParams({
			type: 'object',
			properties: {
				a: { type: 'boolean' },
				b: { type: 'integer' },
				c: { type: 'number' },
				d: { type: 'string' },
				e: { type: 'array' },
			},
		})).toStrictEqual({ a: 'boolean', b: 'integer', c: 'number' });
	});

	test('legacy: properties が無ければ空', () => {
		expect(getCastableParams({ type: 'object' })).toStrictEqual({});
	});
});

describe('misc/schema:error', () => {
	test('formatValibotIssues は dot-path を付ける', () => {
		const result = v.safeParse(v.object({ poll: v.object({ choices: v.array(v.string()) }) }), { poll: { choices: [1] } });
		expect(result.success).toBe(false);

		const details = formatValibotIssues(result.issues ?? []);
		expect(details).toHaveLength(1);
		expect(details[0].path).toBe('poll.choices.0');
		expect(details[0].kind).toBe('schema');
		expect(details[0].type).toBe('string');
		expect(details[0].expected).toBe('string');
		expect(details[0].received).toBe('1');
	});

	test('toInvalidParamInfo は param / reason / details を組み立てる', () => {
		const result = v.safeParse(v.object({ userId: misskeyId() }), { userId: 'has-hyphen' });
		const info = toInvalidParamInfo(result.issues ?? []);

		expect(info.param).toBe('userId');
		expect(typeof info.reason).toBe('string');
		expect(info.details).toHaveLength(1);
	});

	test('ルート自体のエラーは param が (root) になる', () => {
		const result = v.safeParse(v.object({ a: v.string() }), 'not an object');
		const info = toInvalidParamInfo(result.issues ?? []);

		expect(info.param).toBe('(root)');
	});

	test('複数エラーをまとめて返せる (Valibot は既定で全 issue を集める)', () => {
		const result = v.safeParse(v.object({ a: v.string(), b: v.number() }), { a: 1, b: 'x' });
		const info = toInvalidParamInfo(result.issues ?? []);

		expect(info.details.map(d => d.path)).toStrictEqual(['a', 'b']);
	});
});
