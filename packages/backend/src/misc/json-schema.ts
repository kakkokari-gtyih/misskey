/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { packedNoteReactionSchema, packedNoteReactionWithNoteSchema } from '@/models/json-schema/note-reaction.js';
import { packedInviteCodeSchema } from '@/models/json-schema/invite-code.js';
import { packedNoteFavoriteSchema } from '@/models/json-schema/note-favorite.js';
import { packedClipSchema } from '@/models/json-schema/clip.js';
import {
	packedQueueCountSchema,
	packedQueueMetricsSchema,
	packedQueueJobSchema,
} from '@/models/json-schema/queue.js';
import { packedGalleryPostSchema } from '@/models/json-schema/gallery-post.js';
import { packedFlashSchema } from '@/models/json-schema/flash.js';
// NOTE: `packedRoleSchema` (Role) のみ未移行のまま残っている (allOf の inline properties 混在パターンが
// mi.composeEntity() の対応範囲外なため。PR3c-1 でエスカレーション。models/json-schema/role.ts 参照)
import { packedRoleSchema } from '@/models/json-schema/role.js';
import { packedReversiGameDetailedSchema, packedReversiGameLiteSchema } from '@/models/json-schema/reversi-game.js';
import { packedAbuseReportNotificationRecipientSchema } from '@/models/json-schema/abuse-report-notification-recipient.js';
// NOTE: `import type` (下記) は erased されるので、Valibot 化済み entity の defineEntity() 副作用を
// 確実に実行させるための side-effect import を別途行う (`@/models/schema/` 配下は
// endpoint 経由の実 import が無いと `components.schemas` から漏れるため)。
import '@/models/schema/_entities.js';
import type { ValibotPackedMap } from '@/models/schema/_entities.js';

export const refs = {
	NoteReaction: packedNoteReactionSchema,
	NoteReactionWithNote: packedNoteReactionWithNoteSchema,
	NoteFavorite: packedNoteFavoriteSchema,
	InviteCode: packedInviteCodeSchema,
	QueueCount: packedQueueCountSchema,
	QueueMetrics: packedQueueMetricsSchema,
	QueueJob: packedQueueJobSchema,
	Clip: packedClipSchema,
	GalleryPost: packedGalleryPostSchema,
	Flash: packedFlashSchema,
	Role: packedRoleSchema,
	ReversiGameLite: packedReversiGameLiteSchema,
	ReversiGameDetailed: packedReversiGameDetailedSchema,
	AbuseReportNotificationRecipient: packedAbuseReportNotificationRecipientSchema,
};

/**
 * 移行期間中の entity 名 (legacy {@link refs} と {@link ValibotPackedMap} の和集合)。
 *
 * entity を 1 つ Valibot 化するたびに `ValibotPackedMap` へ追記し `refs` から同名エントリを
 * 削除するので、参照側 (`Packed<'Note'>` など) はどちらのレジストリにあっても壊れない。
 */
export type PackedEntityName = keyof typeof refs | keyof ValibotPackedMap;

/** 未移行 legacy entity の「名前 → packed 出力型」対応表 */
type LegacyPackedMap = { [K in keyof typeof refs]: SchemaType<(typeof refs)[K]> };

/**
 * 移行期間中の「名前 → packed 出力型」対応表 (Valibot 済み ∪ legacy)。
 *
 * キーは常に互いに素 (entity を移行したら `refs` から消して `ValibotPackedMap` へ移す) なので
 * 交差型で単純に合成できる。
 *
 * NOTE: `x extends keyof ValibotPackedMap ? ... : x extends keyof typeof refs ? SchemaType<...>`
 * のような条件型で書いてはいけない。ジェネリクス越しに `Packed<S>` を使う箇所
 * (UserEntityService.pack/packMany など) で TypeScript が false 分岐を
 * 「x = keyof typeof refs」で試算し、legacy `SchemaType` を **全 legacy entity の union** に対して
 * インスタンス化するため TS2589 (型のインスタンス化が深すぎる) になる。
 * 添字アクセスなら実際に使われるキーの分しか解決されない。
 */
type PackedMap = ValibotPackedMap & LegacyPackedMap;

/** packed entity の型。 */
export type Packed<x extends PackedEntityName> = PackedMap[x];

export type KeyOf<x extends PackedEntityName> =
	x extends keyof ValibotPackedMap ? keyof ValibotPackedMap[x] & string :
	x extends keyof typeof refs ? PropertiesToUnion<(typeof refs)[x]> :
	never;
type PropertiesToUnion<p extends Schema> = p['properties'] extends NonNullable<Obj> ? keyof p['properties'] : never;

type TypeStringef = 'null' | 'boolean' | 'integer' | 'number' | 'string' | 'array' | 'object' | 'any';
type StringDefToType<T extends TypeStringef> =
	T extends 'null' ? null :
	T extends 'boolean' ? boolean :
	T extends 'integer' ? number :
	T extends 'number' ? number :
	T extends 'string' ? string | Date :
	T extends 'array' ? ReadonlyArray<any> :
	T extends 'object' ? Record<string, any> :
	any;

// https://swagger.io/specification/?sbsearch=optional#schema-object
type OfSchema = {
	readonly anyOf?: ReadonlyArray<Schema>;
	readonly oneOf?: ReadonlyArray<Schema>;
	readonly allOf?: ReadonlyArray<Schema>;
};

export interface Schema extends OfSchema {
	readonly type?: TypeStringef;
	readonly nullable?: boolean;
	readonly optional?: boolean;
	readonly prefixItems?: ReadonlyArray<Schema>;
	readonly items?: Schema;
	readonly unevaluatedItems?: Schema | boolean;
	readonly properties?: Obj;
	readonly required?: ReadonlyArray<Extract<keyof NonNullable<this['properties']>, string>>;
	readonly description?: string;
	readonly example?: any;
	readonly format?: string;
	readonly ref?: PackedEntityName;
	readonly selfRef?: boolean;
	readonly enum?: ReadonlyArray<string | null>;
	readonly default?: (this['type'] extends TypeStringef ? StringDefToType<this['type']> : any) | null;
	readonly maxLength?: number;
	readonly minLength?: number;
	readonly maximum?: number;
	readonly minimum?: number;
	readonly pattern?: string;
	readonly additionalProperties?: Schema | boolean;
}

type RequiredPropertyNames<s extends Obj> = {
	[K in keyof s]:
	// K is not optional
	s[K]['optional'] extends false ? K :
	// K has default value
	s[K]['default'] extends null | string | number | boolean | Record<string, unknown> ? K :
	never
}[keyof s];

export type Obj = Record<string, Schema>;

// https://github.com/misskey-dev/misskey/issues/8535
// To avoid excessive stack depth error,
// deceive TypeScript with UnionToIntersection (or more precisely, `infer` expression within it).
export type ObjType<s extends Obj, RequiredProps extends ReadonlyArray<keyof s>> =
	UnionToIntersection<
		{ -readonly [R in RequiredPropertyNames<s>]-?: SchemaType<s[R]> } &
		{ -readonly [R in RequiredProps[number]]-?: SchemaType<s[R]> } &
		{ -readonly [P in keyof s]?: SchemaType<s[P]> }
	>;

type NullOrUndefined<p extends Schema, T> =
	| (p['nullable'] extends true ? null : never)
	| (p['optional'] extends true ? undefined : never)
	| T;

// https://stackoverflow.com/questions/54938141/typescript-convert-union-to-intersection
// Get intersection from union
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

type ArrayToIntersection<T extends ReadonlyArray<Schema>> =
	T extends readonly [infer Head, ...infer Tail]
		? Head extends Schema
			? Tail extends ReadonlyArray<Schema>
				? Tail extends []
					? SchemaType<Head>
					: SchemaType<Head> & ArrayToIntersection<Tail>
				: never
			: never
		: never;

// https://github.com/misskey-dev/misskey/pull/8144#discussion_r785287552
// To get union, we use `Foo extends any ? Hoge<Foo> : never`
type UnionSchemaType<a extends readonly any[], X extends Schema = a[number]> = X extends any ? SchemaType<X> : never;
//type UnionObjectSchemaType<a extends readonly any[], X extends Schema = a[number]> = X extends any ? ObjectSchemaType<X> : never;
type UnionObjType<s extends Obj, a extends readonly any[], X extends ReadonlyArray<keyof s> = a[number]> = X extends any ? ObjType<s, X> : never;
type ArrayUnion<T> = T extends any ? Array<T> : never;
type ArrayToTuple<X extends ReadonlyArray<Schema>> = { [K in keyof X]: SchemaType<X[K]> };

type ObjectSchemaTypeDef<p extends Schema> =
	p['ref'] extends PackedEntityName ? Packed<p['ref']> :
	p['properties'] extends NonNullable<Obj> ?
		p['anyOf'] extends ReadonlyArray<Schema> ? p['anyOf'][number]['required'] extends ReadonlyArray<keyof p['properties']> ?
			UnionObjType<p['properties'], NonNullable<p['anyOf'][number]['required']>> & ObjType<p['properties'], NonNullable<p['required']>>
			: never
		: ObjType<p['properties'], NonNullable<p['required']>>
		:
		p['anyOf'] extends ReadonlyArray<Schema> ? UnionSchemaType<p['anyOf']> :
		p['allOf'] extends ReadonlyArray<Schema> ? ArrayToIntersection<p['allOf']> :
		p['additionalProperties'] extends true ? Record<string, any> :
		p['additionalProperties'] extends Schema ?
			p['additionalProperties'] extends infer AdditionalProperties ?
				AdditionalProperties extends Schema ?
					Record<string, SchemaType<AdditionalProperties>> :
					never :
				never :
			any;

export type SchemaTypeDef<p extends Schema> =
	p['type'] extends 'null' ? null :
	p['type'] extends 'integer' ? number :
	p['type'] extends 'number' ? number :
	p['type'] extends 'string' ? (
		p['enum'] extends readonly (string | null)[] ?
			p['enum'][number] :
			p['format'] extends 'date-time' ? string : // Dateにする？？
			string
	) :
		p['type'] extends 'boolean' ? boolean :
		p['type'] extends 'object' ? ObjectSchemaTypeDef<p> :
		p['type'] extends 'array' ? (
			p['items'] extends OfSchema ? (
				p['items']['anyOf'] extends ReadonlyArray<Schema> ? UnionSchemaType<NonNullable<p['items']['anyOf']>>[] :
				p['items']['oneOf'] extends ReadonlyArray<Schema> ? ArrayUnion<UnionSchemaType<NonNullable<p['items']['oneOf']>>> :
				p['items']['allOf'] extends ReadonlyArray<Schema> ? UnionToIntersection<UnionSchemaType<NonNullable<p['items']['allOf']>>>[] :
				never
			) :
				p['prefixItems'] extends ReadonlyArray<Schema> ? (
					p['items'] extends NonNullable<Schema> ? [...ArrayToTuple<p['prefixItems']>, ...SchemaType<p['items']>[]] :
					p['items'] extends false ? ArrayToTuple<p['prefixItems']> :
					p['unevaluatedItems'] extends false ? ArrayToTuple<p['prefixItems']> :
					[...ArrayToTuple<p['prefixItems']>, ...unknown[]]
				) :
					p['items'] extends NonNullable<Schema> ? SchemaType<p['items']>[] :
					any[]
		) :
			p['anyOf'] extends ReadonlyArray<Schema> ? UnionSchemaType<p['anyOf']> :
			p['allOf'] extends ReadonlyArray<Schema> ? ArrayToIntersection<p['allOf']> :
			p['oneOf'] extends ReadonlyArray<Schema> ? UnionSchemaType<p['oneOf']> :
			any;

export type SchemaType<p extends Schema> = NullOrUndefined<p, SchemaTypeDef<p>>;
