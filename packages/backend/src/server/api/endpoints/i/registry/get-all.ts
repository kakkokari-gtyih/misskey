/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as v from 'valibot';
import * as mi from '@/misc/schema/index.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RegistryApiService } from '@/core/RegistryApiService.js';

export const meta = {
	requireCredential: true,
	kind: 'read:account',

	res: mi.anyObject(),
} as const;

// NOTE: legacy は `required: ['scope']` と `default: []` が同居していたが、AJV useDefaults は
// required チェック前に default を埋めるため実際には省略可能だった。実態に合わせて v.optional(x, []) にする
export const paramDef = v.object({
	scope: v.optional(v.array(v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_]+$/))), []),
	domain: v.nullish(v.string()),
});

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private registryApiService: RegistryApiService,
	) {
		super(meta, paramDef, async (ps, me, accessToken) => {
			const items = await this.registryApiService.getAllItemsOfScope(me.id, accessToken != null ? accessToken.id : (ps.domain ?? null), ps.scope);

			const res = {} as Record<string, any>;

			for (const item of items) {
				res[item.key] = item.value;
			}

			return res;
		});
	}
}
