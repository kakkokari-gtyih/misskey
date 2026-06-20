/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { WebAuthnService } from '@/core/WebAuthnService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	requireCredential: true,
	requireSudo: true,

	secure: true,

	errors: {
		userNotFound: {
			message: 'User not found.',
			code: 'USER_NOT_FOUND',
			id: '652f899f-66d4-490e-993e-6606c8ec04c3',
		},
	},

	res: {
		type: 'object',
		nullable: false,
		optional: false,
		properties: {},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
	},
	required: [],
} as const;

// eslint-disable-next-line import/no-default-export
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private webAuthnService: WebAuthnService,
	) {
		super(meta, paramDef, async (_, me) => {
			const profile = await this.userProfilesRepository.findOne({
				where: {
					userId: me.id,
				},
				relations: { user: true },
			});

			if (profile == null) {
				throw new ApiError(meta.errors.userNotFound);
			}

			return await this.webAuthnService.initiateRegistration(
				me.id,
				profile.user?.username ?? me.id,
				profile.user?.name ?? undefined,
			);
		});
	}
}
