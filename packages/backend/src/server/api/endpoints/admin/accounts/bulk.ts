/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MiUser, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { UserSuspendService } from '@/core/UserSuspendService.js';
import { DeleteAccountService } from '@/core/DeleteAccountService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:account',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			unsuspend: {
				type: 'object', optional: true,
				properties: {
					success: { type: 'array', optional: false, nullable: false, items: { type: 'string', format: 'misskey:id' } },
					failure: { type: 'array', optional: false, nullable: false, items: { type: 'string', format: 'misskey:id' } },
				},
			},
			suspend: {
				type: 'object', optional: true,
				properties: {
					success: { type: 'array', optional: false, nullable: false, items: { type: 'string', format: 'misskey:id' } },
					failure: { type: 'array', optional: false, nullable: false, items: { type: 'string', format: 'misskey:id' } },
				},
			},
			delete: {
				type: 'object', optional: true,
				properties: {
					success: { type: 'array', optional: false, nullable: false, items: { type: 'string', format: 'misskey:id' } },
					failure: { type: 'array', optional: false, nullable: false, items: { type: 'string', format: 'misskey:id' } },
				},
			},
		},
	},

	errors: {
		duplicated: {
			message: 'Some users are duplicated.',
			code: 'DUPLICATED',
			id: 'd3c3b0b2-6a6f-4a0e-8a1c-9f4a4d3f0d4b',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		unsuspend: { type: 'array', optional: true, items: { type: 'string', format: 'misskey:id' } },
		suspend: { type: 'array', optional: true, items: { type: 'string', format: 'misskey:id' } },
		delete: { type: 'array', optional: true, items: { type: 'string', format: 'misskey:id' } },
	},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private userSuspendService: UserSuspendService,
		private deleteAccoountService: DeleteAccountService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (new Set([...(ps.unsuspend ?? []), ...(ps.suspend ?? []), ...(ps.delete ?? [])]).size !== (ps.unsuspend?.length ?? 0) + (ps.suspend?.length ?? 0) + (ps.delete?.length ?? 0)) {
				throw new ApiError(meta.errors.duplicated);
			}

			const canOperate = (user: MiUser) => {
				if (user.isRoot) return false;
				if (user.id === me.id) return false;
				return true;
			};

			const unsuspendPromises: Promise<string>[] = [];
			const unsuspendIds = new Set<string>((ps.unsuspend ?? []));
			const unsuspendSuccess = new Set<string>();
			let unsuspendFailure = new Set<string>();
			if (unsuspendIds.size > 0) {
				for (const userId of unsuspendIds) {
					const user = await this.usersRepository.findOneBy({ id: userId });
					if (user == null) {
						unsuspendFailure.add(userId);
						continue;
					}
					if (canOperate(user) && user.isSuspended) {
						unsuspendPromises.push(this.userSuspendService.unsuspend(user, me).then(() => userId));
					} else {
						unsuspendFailure.add(userId);
					}
				}
			}

			const suspendPromises: Promise<string>[] = [];
			const suspendIds = new Set<string>((ps.suspend ?? []));
			const suspendSuccess = new Set<string>();
			let suspendFailure = new Set<string>();
			if (suspendIds.size > 0) {
				for (const userId of suspendIds) {
					const user = await this.usersRepository.findOneBy({ id: userId });
					if (user == null) {
						suspendFailure.add(userId);
						continue;
					}
					if (canOperate(user) && !user.isSuspended) {
						suspendPromises.push(this.userSuspendService.suspend(user, me).then(() => userId));
					} else {
						suspendFailure.add(userId);
					}
				}
			}

			const deletePromises: Promise<string>[] = [];
			const deleteIds = new Set<string>((ps.delete ?? []));
			const deleteSuccess = new Set<string>();
			let deleteFailure = new Set<string>();
			if (deleteIds.size > 0) {
				for (const userId of deleteIds) {
					const user = await this.usersRepository.findOneBy({ id: userId });
					if (user == null) {
						deleteFailure.add(userId);
						continue;
					}
					if (canOperate(user)) {
						deletePromises.push(this.deleteAccoountService.deleteAccount(user).then(() => userId));
					} else {
						deleteFailure.add(userId);
					}
				}
			}

			if (unsuspendIds.size > 0) {
				if (unsuspendPromises.length === 0) {
					unsuspendFailure = new Set(unsuspendIds);
				} else {
					await Promise.allSettled(unsuspendPromises).then((res) => {
						res.forEach((result) => {
							if (result.status === 'fulfilled') {
								unsuspendSuccess.add(result.value);
							}
						});
					});

					unsuspendFailure = unsuspendIds.difference(unsuspendSuccess);
				}
			}

			if (suspendIds.size > 0) {
				if (suspendPromises.length === 0) {
					suspendFailure = new Set(suspendIds);
				} else {
					await Promise.allSettled(suspendPromises).then((res) => {
						res.forEach((result) => {
							if (result.status === 'fulfilled') {
								suspendSuccess.add(result.value);
							}
						});
					});

					suspendFailure = suspendIds.difference(suspendSuccess);
				}
			}

			if (deleteIds.size > 0) {
				if (deletePromises.length === 0) {
					deleteFailure = new Set(deleteIds);
				} else {
					await Promise.allSettled(deletePromises).then((res) => {
						res.forEach((result) => {
							if (result.status === 'fulfilled') {
								deleteSuccess.add(result.value);
							}
						});
					});

					deleteFailure = deleteIds.difference(deleteSuccess);
				}
			}

			return {
				unsuspend: {
					success: Array.from(unsuspendSuccess.values()),
					failure: Array.from(unsuspendFailure.values()),
				},
				suspend: {
					success: Array.from(suspendSuccess.values()),
					failure: Array.from(suspendFailure.values()),
				},
				delete: {
					success: Array.from(deleteSuccess.values()),
					failure: Array.from(deleteFailure.values()),
				},
			};
		});
	}
}
