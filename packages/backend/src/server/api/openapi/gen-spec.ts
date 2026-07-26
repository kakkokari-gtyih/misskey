/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Config } from '@/config.js';
import { resAllowsEmpty } from '@/misc/schema/bridge.js';
import endpoints from '../endpoints.js';
import { errors as basicErrors } from './errors.js';
import { getSchemas, convertEndpointSchemaToOpenApi } from './schemas.js';

export function genOpenapiSpec(config: Config, includeSelfRef = false) {
	const spec = {
		openapi: '3.1.0',

		info: {
			version: config.version,
			title: 'Misskey API',
		},

		externalDocs: {
			description: 'Repository',
			url: 'https://github.com/misskey-dev/misskey',
		},

		servers: [{
			url: config.apiUrl,
		}],

		paths: {} as any,

		components: {
			schemas: getSchemas(includeSelfRef),

			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
				},
			},
		},
	};

	// NOTE: endpoints 自体をディープコピーすることはできない (Valibot スキーマは関数を含むため
	// JSON 往復で壊れる)。代わりに、endpoints から読み取った値を **変換後のプレーンな OpenAPI 構造**
	// にしてからディープコピーして spec に載せる。こうしないと生成物が endpoints の meta を参照した
	// ままになり、生成物を書き換えたときにメモリ上の値が汚れて次回以降の出力に影響する
	for (const endpoint of endpoints) {
		const errors = {} as any;

		if (endpoint.meta.errors) {
			for (const e of Object.values(endpoint.meta.errors)) {
				errors[e.code] = {
					value: {
						error: e,
					},
				};
			}
		}

		const resSchema = endpoint.meta.res ? convertEndpointSchemaToOpenApi(endpoint.meta.res, 'res', includeSelfRef) : {};

		let desc = (endpoint.meta.description ? endpoint.meta.description : 'No description provided.') + '\n\n';

		if (endpoint.meta.secure) {
			desc += '**Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.\n';
		}

		desc += `**Credential required**: *${endpoint.meta.requireCredential ? 'Yes' : 'No'}*`;
		if (endpoint.meta.kind) {
			const kind = endpoint.meta.kind;
			desc += ` / **Permission**: *${kind}*`;
		}

		const requestType = endpoint.meta.requireFile ? 'multipart/form-data' : 'application/json';
		const schema = { ...convertEndpointSchemaToOpenApi(endpoint.params, 'param', false) };

		// TODO: paramDef が Valibot 化された endpoint (drive/files/create など) では
		// properties / required への直接注入ではなく Valibot 側で file を表現する必要がある
		if (endpoint.meta.requireFile) {
			schema.properties = {
				...schema.properties,
				file: {
					type: 'string',
					format: 'binary',
					description: 'The file contents.',
				},
			};
			schema.required = [...schema.required ?? [], 'file'];
		}

		if (schema.required && schema.required.length <= 0) {
			// 空配列は許可されない
			schema.required = undefined;
		}

		const hasBody = (schema.type === 'object' && schema.properties && Object.keys(schema.properties).length >= 1)
			|| ['allOf', 'oneOf', 'anyOf'].some(o => (Array.isArray(schema[o]) && schema[o].length >= 0));

		const info = {
			operationId: endpoint.name.replaceAll('/', '___'), // NOTE: スラッシュは使えない
			summary: endpoint.name,
			description: desc,
			externalDocs: {
				description: 'Source code',
				url: `https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/${endpoint.name}.ts`,
			},
			...(endpoint.meta.tags ? {
				tags: [endpoint.meta.tags[0]],
			} : {}),
			...(endpoint.meta.requireCredential ? {
				security: [{
					bearerAuth: [],
				}],
			} : {}),
			...(hasBody ? {
				requestBody: {
					required: true,
					content: {
						[requestType]: {
							schema,
						},
					},
				},
			} : {}),
			responses: {
				...(endpoint.meta.res ? {
					'200': {
						description: 'OK (with results)',
						content: {
							'application/json': {
								schema: resSchema,
							},
						},
					},
				} : {
					'204': {
						description: 'OK (without any results)',
					},
				}),
				...(resAllowsEmpty(endpoint.meta.res) ? {
					'204': {
						description: 'OK (without any results)',
					},
				} : {}),
				'400': {
					description: 'Client error',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/Error',
							},
							examples: { ...errors, ...basicErrors['400'] },
						},
					},
				},
				'401': {
					description: 'Authentication error',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/Error',
							},
							examples: basicErrors['401'],
						},
					},
				},
				'403': {
					description: 'Forbidden error',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/Error',
							},
							examples: basicErrors['403'],
						},
					},
				},
				'418': {
					description: 'I\'m Ai',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/Error',
							},
							examples: basicErrors['418'],
						},
					},
				},
				...(endpoint.meta.limit ? {
					'429': {
						description: 'Too many requests',
						content: {
							'application/json': {
								schema: {
									$ref: '#/components/schemas/Error',
								},
								examples: basicErrors['429'],
							},
						},
					},
				} : {}),
				'500': {
					description: 'Internal server error',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/Error',
							},
							examples: basicErrors['500'],
						},
					},
				},
			},
		};

		// ここまでで info はプレーンな OpenAPI 構造 (meta.errors 等の参照は含む) なので、
		// spec に載せる前にディープコピーして endpoints 側との参照共有を切る
		spec.paths['/' + endpoint.name] = structuredClone({
			...(endpoint.meta.allowGet ? {
				get: {
					...info,
					operationId: 'get___' + info.operationId,
				},
			} : {}),
			post: {
				...info,
				operationId: 'post___' + info.operationId,
			},
		});
	}

	return spec;
}
