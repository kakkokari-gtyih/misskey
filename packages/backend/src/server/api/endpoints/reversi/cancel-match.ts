/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { IEndpointMeta } from '@/server/api/endpoints.js';
import type { Schema } from '@/misc/json-schema.js';
import { ReversiService } from '@/core/ReversiService.js';

export const meta = {
	requireCredential: true,

	kind: 'write:account',

	errors: {
	},
} as const satisfies IEndpointMeta;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id', nullable: true },
	},
	required: [],
} as const satisfies Schema;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private reversiService: ReversiService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.userId) {
				await this.reversiService.matchSpecificUserCancel(me, ps.userId);
				return;
			} else {
				await this.reversiService.matchAnyUserCancel(me);
			}
		});
	}
}
