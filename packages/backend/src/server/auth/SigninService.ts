/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { SigninsRepository, UserProfilesRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import type { MiLocalUser } from '@/models/User.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { SigninEntityService } from '@/core/entities/SigninEntityService.js';
import { bindThis } from '@/decorators.js';
import { EmailService } from '@/core/EmailService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { AuthenticateService } from '@/server/auth/AuthenticateService.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class SigninService {
	constructor(
		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private signinEntityService: SigninEntityService,
		private authenticateService: AuthenticateService,
		private emailService: EmailService,
		private notificationService: NotificationService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
	) {
	}

	@bindThis
	public async signin(request: FastifyRequest, reply: FastifyReply, user: MiLocalUser) {
		const nativeRefreshToken = secureRndstr(64);

		const signinRecord = await this.signinsRepository.insertOne({
			id: this.idService.gen(),
			userId: user.id,
			ip: request.ip,
			headers: request.headers as any,
			success: true,
			refreshToken: nativeRefreshToken,
		});

		// サインイン初回はsudo
		const jwt = await this.authenticateService.generateNativeTokens(user, signinRecord, true);

		setImmediate(async () => {
			this.notificationService.createNotification(user.id, 'login', {});

			this.globalEventService.publishMainStream(user.id, 'signin', await this.signinEntityService.pack(signinRecord));

			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });
			if (profile.email && profile.emailVerified) {
				this.emailService.sendEmail(profile.email, 'New login / ログインがありました',
					'There is a new login. If you do not recognize this login, update the security status of your account, including changing your password. / 新しいログインがありました。このログインに心当たりがない場合は、パスワードを変更するなど、アカウントのセキュリティ状態を更新してください。',
					'There is a new login. If you do not recognize this login, update the security status of your account, including changing your password. / 新しいログインがありました。このログインに心当たりがない場合は、パスワードを変更するなど、アカウントのセキュリティ状態を更新してください。');
			}
		});

		reply.code(200);

		return {
			id: user.id,
			accessToken: jwt.accessToken,
			refreshToken: jwt.refreshToken,
		};
	}
}

