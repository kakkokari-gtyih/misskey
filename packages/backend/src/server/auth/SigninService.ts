/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import { DI } from '@/di-symbols.js';
import type { SigninsRepository, UserProfilesRepository } from '@/models/_.js';
import type Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { SigninEntityService } from '@/core/entities/SigninEntityService.js';
import { bindThis } from '@/decorators.js';
import { EmailService } from '@/core/EmailService.js';
import { NotificationService } from '@/core/NotificationService.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MiLocalUser } from '@/models/User.js';

type SigninData = {
	id: MiLocalUser['id'];
	config: {
		totp: boolean; // 二要素認証が設定されているか
		passkey: boolean; // パスキー認証が設定されているか
	};
	result: {
		password: boolean; // パスワード認証に成功したか
		totp: boolean; // 二要素認証に成功したか
		passkey: boolean; // パスキー認証に成功したか
	};
};

//#region API Types
type SigninFlowInitRequest = {
	username: string;
}

type SigninFlowContinueRequest = {
	sessionId: string;
} & ({
	password: string;
} | {
	passkeyCredential: AuthenticationResponseJSON;
} | {
	totp: string;
});

type SigninFlowRequest = SigninFlowInitRequest | SigninFlowContinueRequest;
//#endregion

@Injectable()
export class SigninService {
	private logger: Logger;

	constructor(
		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private loggerService: LoggerService,
		private signinEntityService: SigninEntityService,
		private emailService: EmailService,
		private notificationService: NotificationService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
	) {
		this.logger = this.loggerService.getLogger('Signin');
	}

	@bindThis
	public signinRequestHandler(request: FastifyRequest<{ Body: SigninFlowRequest }>, reply: FastifyReply) {
		if ('username' in request.body) {
			return this.handleSigninInit(request as FastifyRequest<{ Body: SigninFlowInitRequest }>, reply);
		} else {
			return this.handleSigninContinue(request as FastifyRequest<{ Body: SigninFlowContinueRequest }>, reply);
		}
	}

	@bindThis
	private async handleSigninInit(request: FastifyRequest<{ Body: SigninFlowInitRequest }>, reply: FastifyReply) {

	}

	@bindThis
	private async handleSigninContinue(request: FastifyRequest<{ Body: SigninFlowContinueRequest }>, reply: FastifyReply) {
	}
}
