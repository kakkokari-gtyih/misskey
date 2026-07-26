/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import _Ajv from 'ajv';
import * as v from 'valibot';
import type { Schema } from '@/misc/json-schema.js';
import { isValibotSchema } from '@/misc/schema/bridge.js';
import type { AnyValibotSchema, EndpointSchema, SchemaOutput } from '@/misc/schema/bridge.js';
import { toInvalidParamInfo } from '@/misc/schema/error.js';
import { MISSKEY_ID_REGEX } from '@/misc/schema/helpers.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiAccessToken } from '@/models/AccessToken.js';
import { ApiError } from './error.js';
import type { IEndpointMeta } from './endpoints.js';

const Ajv = _Ajv.default;

const ajv = new Ajv({
	useDefaults: true,
});

ajv.addFormat('misskey:id', MISSKEY_ID_REGEX);

export type Response = Record<string, any> | void;

type File = {
	name: string | null;
	path: string;
};

type Executor<T extends IEndpointMeta, Ps extends EndpointSchema> =
	(params: SchemaOutput<Ps>, user: T['requireCredential'] extends true ? MiLocalUser : MiLocalUser | null, token: MiAccessToken | null, file?: File, cleanup?: () => any, ip?: string | null, headers?: Record<string, string> | null) =>
		Promise<T['res'] extends undefined ? Response : SchemaOutput<NonNullable<T['res']>>>;

/** paramDef による検証結果。成功時の `value` が `cb` に渡される値になる */
type ValidationResult =
	{ ok: true, value: unknown } |
	{ ok: false, error: ApiError };

type Validator = (params: unknown) => ValidationResult;

function invalidParamError(info: Record<string, unknown>): ApiError {
	return new ApiError({
		message: 'Invalid param.',
		code: 'INVALID_PARAM',
		id: '3d81ceae-475f-4600-b2a8-2bc116157532',
	}, info);
}

/**
 * Valibot スキーマ用の validator。
 *
 * `v.safeParse()` の出力 (default 適用済みの **新しいオブジェクト**) をハンドラに渡す
 * (legacy の AJV useDefaults による in-place mutate とは異なる)。
 */
function makeValibotValidator(paramDef: AnyValibotSchema): Validator {
	return (params: unknown) => {
		const result = v.safeParse(paramDef, params);
		if (!result.success) {
			return { ok: false, error: invalidParamError(toInvalidParamInfo(result.issues)) };
		}
		return { ok: true, value: result.output };
	};
}

/**
 * legacy の独自 JSON Schema 用の validator (現行挙動をそのまま維持)。
 *
 * AJV は `useDefaults` により渡されたオブジェクトを in-place で書き換えるので、
 * 成功時はそのオブジェクト自身をハンドラに渡す。
 */
function makeAjvValidator(paramDef: Schema): Validator {
	const validate = ajv.compile(paramDef);

	return (params: unknown) => {
		if (validate(params)) return { ok: true, value: params };

		const errors = validate.errors!;
		return {
			ok: false,
			error: invalidParamError({
				param: errors[0].schemaPath,
				reason: errors[0].message,
			}),
		};
	};
}

export abstract class Endpoint<T extends IEndpointMeta, Ps extends EndpointSchema> {
	public exec: (params: any, user: T['requireCredential'] extends true ? MiLocalUser : MiLocalUser | null, token: MiAccessToken | null, file?: File, ip?: string | null, headers?: Record<string, string> | null) => Promise<any>;

	constructor(meta: T, paramDef: Ps, cb: Executor<T, Ps>) {
		const validate: Validator = isValibotSchema(paramDef)
			? makeValibotValidator(paramDef)
			: makeAjvValidator(paramDef as Schema);

		this.exec = (params: any, user: T['requireCredential'] extends true ? MiLocalUser : MiLocalUser | null, token: MiAccessToken | null, file?: File, ip?: string | null, headers?: Record<string, string> | null) => {
			let cleanup: undefined | (() => void) = undefined;

			if (meta.requireFile) {
				cleanup = () => {
					if (file) fs.unlink(file.path, () => {});
				};

				if (file == null) return Promise.reject(new ApiError({
					message: 'File required.',
					code: 'FILE_REQUIRED',
					id: '4267801e-70d1-416a-b011-4ee502885d8b',
				}));
			}

			const result = validate(params);
			if (!result.ok) {
				if (file) cleanup!();

				return Promise.reject(result.error);
			}

			return cb(result.value as SchemaOutput<Ps>, user, token, file, cleanup, ip, headers);
		};
	}
}
