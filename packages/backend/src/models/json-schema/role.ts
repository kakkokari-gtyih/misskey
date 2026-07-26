/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// NOTE: RoleLite / RolePolicies / RoleCondFormula* は Valibot 化済み
// (@/models/schema/role.js を参照)。`packedRoleSchema` (この export) だけが未移行のまま残っている。
//
// エスカレーション (PR3c-1): `allOf` の 1 要素が名前付き ref (`RoleLite`) で、もう 1 要素が
// ref の無い inline properties (createdAt 等) という混在パターンは、現行の
// `mi.composeEntity()` (「全パート defineEntity 済み」制約) にそのまま当てはまらない
// (cookbook R9 の「既知の非対応パターン」に明記されている既知の escalation ケース)。
// 無理に inline 部分だけの仮 entity 名をでっち上げて登録すると allOf の出力形が変わりかねないため、
// このバッチでは変換せず legacy のまま残置する。`ref: 'RoleLite'` / `ref: 'RoleCondFormulaValue'` は
// 文字列ベースの参照なので、参照先が Valibot 化されていても legacy コンバータ側で解決できる
// (server/api/openapi/schemas.ts の convertSchemaToOpenApiSchema は ref を name の文字列としてのみ扱う)。
export const packedRoleSchema = {
	type: 'object',
	allOf: [
		{
			type: 'object',
			ref: 'RoleLite',
		},
		{
			type: 'object',
			properties: {
				createdAt: {
					type: 'string',
					optional: false, nullable: false,
					format: 'date-time',
				},
				updatedAt: {
					type: 'string',
					optional: false, nullable: false,
					format: 'date-time',
				},
				target: {
					type: 'string',
					optional: false, nullable: false,
					enum: ['manual', 'conditional'],
				},
				condFormula: {
					type: 'object',
					optional: false, nullable: false,
					ref: 'RoleCondFormulaValue',
				},
				isPublic: {
					type: 'boolean',
					optional: false, nullable: false,
					example: false,
				},
				isExplorable: {
					type: 'boolean',
					optional: false, nullable: false,
					example: false,
				},
				asBadge: {
					type: 'boolean',
					optional: false, nullable: false,
					example: false,
				},
				preserveAssignmentOnMoveAccount: {
					type: 'boolean',
					optional: false, nullable: false,
					example: false,
				},
				canEditMembersByModerator: {
					type: 'boolean',
					optional: false, nullable: false,
					example: false,
				},
				policies: {
					type: 'object',
					optional: false, nullable: false,
					additionalProperties: {
						anyOf: [{
							type: 'object',
							properties: {
								value: {
									oneOf: [
										{
											type: 'integer',
										},
										{
											type: 'boolean',
										},
									],
								},
								priority: {
									type: 'integer',
								},
								useDefault: {
									type: 'boolean',
								},
							},
						}],
					},
				},
				usersCount: {
					type: 'integer',
					optional: false, nullable: false,
				},
			},
		},
	],
} as const;
