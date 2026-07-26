/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * AJV + 独自 JSON Schema から Valibot への段階的移行の基盤。
 *
 * - {@link ./helpers.js}: Misskey 共通の DSL (`misskeyId()` / `limit()` / `maxCodePoints()` など)
 * - {@link ./metadata.js}: OpenAPI 出力用メタデータ (`format()` / `example()` / `selfRef()` など)
 * - {@link ./registry.js}: entity レジストリ (`defineEntity()` / `composeEntity()` / `entityRef()`)
 * - {@link ./bridge.js}: legacy JSON Schema と Valibot の共存ブリッジ
 * - {@link ./openapi.js}: Valibot → OpenAPI (api.json) コンバータ
 * - {@link ./error.js}: `INVALID_PARAM` の info 組み立て
 * - {@link ./cast.js}: GET / multipart のキャスト対象抽出
 */

export {
	MISSKEY_ID_REGEX,
	CODE_POINTS_MARKER,
	UNIQUE_ITEMS_MARKER,
	countCodePoints,
	readCodePointsMarker,
	hasUniqueItemsMarker,
	misskeyId,
	integer,
	limit,
	idString,
	dateTimeString,
	urlString,
	minCodePoints,
	maxCodePoints,
	uniqueArray,
	nullableEnum,
	anyObject,
	anyRecord,
	anyArray,
	paginationEntries,
	paginationDateEntries,
} from './helpers.js';
export type { CodePointsMarker, LimitOptions } from './helpers.js';

export {
	OPENAPI_SKIP,
	miMeta,
	format,
	example,
	deprecated,
	selfRef,
	asOneOf,
	openApi,
	omitKeywords,
	skipInOpenApi,
	isSkippedInOpenApi,
	mergeMetadata,
} from './metadata.js';
export type { EntityName, MiMeta, CollectedMetadata } from './metadata.js';

export {
	defineEntity,
	lookupEntityName,
	resolveEntity,
	getRegisteredEntities,
	entityRef,
	composeEntity,
} from './registry.js';
export type { ComposedInput, ComposedOutput } from './registry.js';

export {
	isValibotSchema,
	unwrapPipe,
	baseTypeOf,
	allowsAbsent,
	resAllowsEmpty,
} from './bridge.js';
export type { AnyValibotSchema, EndpointSchema, SchemaInput, SchemaOutput } from './bridge.js';

export { valibotToOpenApi } from './openapi.js';
export type { OpenApiSchemaObject, ValibotOpenApiContext } from './openapi.js';

export { formatValibotIssues, toInvalidParamInfo } from './error.js';
export type { InvalidParamInfo, ValibotIssueDetail } from './error.js';

export { getCastableParams } from './cast.js';
export type { CastableType } from './cast.js';
