/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DeleteAccountService } from '@/core/DeleteAccountService.js';

export const meta = {
	requireCredential: true,
	requireFullUserData: true,
	requireSudo: true,

	secure: true,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private deleteAccountService: DeleteAccountService,
	) {
		super(meta, paramDef, async (_, me) => {
			await this.deleteAccountService.deleteAccount(me);
		});
	}
}
