/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import Ajv from 'ajv';
import * as v from 'valibot';
import { isValibotSchema } from '@/misc/schema/bridge.js';
import { MISSKEY_ID_REGEX } from '@/misc/schema/helpers.js';
import type { EndpointSchema } from '@/misc/schema/bridge.js';

/**
 * paramDef を「入力が妥当か」を boolean で返す関数に変換する。
 *
 * 移行期間中は legacy の独自 JSON Schema と Valibot スキーマが混在するので両方受け付ける
 * (legacy 側は AJV `useDefaults: true` で入力を in-place に書き換える現行挙動をそのまま維持する)。
 */
export const getValidator = (paramDef: EndpointSchema): ((params: unknown) => boolean) => {
	if (isValibotSchema(paramDef)) {
		return (params: unknown) => v.safeParse(paramDef, params).success;
	}

	const ajv = new Ajv.default({
		useDefaults: true,
	});
	ajv.addFormat('misskey:id', MISSKEY_ID_REGEX);

	const validate = ajv.compile(paramDef);
	return (params: unknown) => validate(params);
};
