/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import * as Redis from 'ioredis';
import bcrypt from 'bcryptjs';
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { bindThis } from '@/decorators.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';

import type { MiMeta, SigninsRepository, UsersRepository, UserProfilesRepository, UserSecurityKeysRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type Logger from '@/logger.js';

import { LoggerService } from '@/core/LoggerService.js';
import { RateLimiterService } from '@/server/api/RateLimiterService.js';
import { WebAuthnService } from '@/core/WebAuthnService.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { SigninEntityService } from '@/core/entities/SigninEntityService.js';
import { EmailService } from '@/core/EmailService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { CaptchaService } from '@/core/CaptchaService.js';
import { TotpService } from '@/core/TotpService.js';
import { AuthenticateService } from '@/server/auth/AuthenticateService.js';

import { getIpHash } from '@/misc/get-ip-hash.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { FastifyReplyError } from '@/misc/fastify-reply-error.js';


interface SigninDataBase {
	result: {
		password: boolean;
		totp: boolean;
		passkey: boolean;
	};
}

interface SigninDataInitial extends SigninDataBase {
	id: null;
	config: null;
}

interface SigninDataWithUser extends SigninDataBase {
	id: MiLocalUser['id'];
	config: {
		totp: boolean; // 二要素認証が設定されているか
		passkey: boolean; // パスキー認証が設定されているか
		passkeyPasswordless: boolean; // パスキー認証でパスワードレスログインを有効にしているか
	};
}

type SigninData = SigninDataInitial | SigninDataWithUser;

interface SigninIndvidualResult {
	success: boolean;
	error?: {
		id: string;
		code?: number;
	};
};

//#region API Types
type SigninFlowInitRequest = {};

interface SigninFlowContinueRequestBase {
	sessionId: string;
}
interface SigninFlowContinueRequestUsername extends SigninFlowContinueRequestBase {
	username: string;
	captchaResponse?: {
		type: 'hcaptcha' | 'recaptcha-v2' | 'turnstile' | 'mcaptcha' | 'testcaptcha';
		response: string;
	};
}
interface SigninFlowContinueRequestPassword extends SigninFlowContinueRequestBase {
	password: string;
}
interface SigninFlowContinueRequestPasskey extends SigninFlowContinueRequestBase {
	passkeyCredential: AuthenticationResponseJSON;
}
interface SigninFlowContinueRequestTotp extends SigninFlowContinueRequestBase {
	totp: string;
}
type SigninFlowContinueRequest = SigninFlowContinueRequestUsername | SigninFlowContinueRequestPassword | SigninFlowContinueRequestPasskey | SigninFlowContinueRequestTotp;

type SigninFlowRequest = SigninFlowInitRequest | SigninFlowContinueRequest;

type SigninFlowInitResponse = {
	sessionId: string;
	passkeyOptions: PublicKeyCredentialRequestOptionsJSON;
};

type SigninFlowContinueResponse = {
	next: 'password' | 'totp';
} | {
	next: 'passkey';
	passkeyOptions: PublicKeyCredentialRequestOptionsJSON;
} | {
	next: null;
};

type SigninFlowResponse = SigninFlowInitResponse | SigninFlowContinueResponse;
//#endregion

function error(reply: FastifyReply, status: number, error: { id: string }) {
	reply.code(status);
	return { error };
}

function isSigninDataWithUser(data: SigninData): data is SigninDataWithUser {
	return data.id !== null && data.config !== null;
}

function computeNextSigninStep(signinData: SigninDataWithUser): 'password' | 'totp' | 'passkey' | null {
	if (!signinData.result.password) {
		return signinData.config.passkeyPasswordless ? 'passkey' : 'password';
	} else if (signinData.config.passkey && !signinData.result.passkey) {
		return 'passkey';
	} else if (signinData.config.totp && !signinData.result.totp) {
		return 'totp';
	} else {
		return null;
	}
}

@Injectable()
export class SigninApiService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.userSecurityKeysRepository)
		private userSecurityKeysRepository: UserSecurityKeysRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private loggerService: LoggerService,
		private rateLimiterService: RateLimiterService,
		private webAuthnService: WebAuthnService,
		private signinEntityService: SigninEntityService,
		private emailService: EmailService,
		private notificationService: NotificationService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
		private captchaService: CaptchaService,
		private totpService: TotpService,
		private authenticateService: AuthenticateService,
	) {
		this.logger = this.loggerService.getLogger('Signin');
	}

	@bindThis
	public async signinRequestHandler(request: FastifyRequest<{ Body: SigninFlowRequest }>, reply: FastifyReply) {
		if (this.config.enableIpRateLimit) {
			if (process.env.NODE_ENV === 'production' && (request.ip === '::1' || request.ip === '127.0.0.1')) {
				this.logger.warn('Recieved signin request from localhost IP address for rate limiting in production environment. This is likely due to an improper trustProxy setting in the config file.');
			}
			const rateLimit = await this.rateLimiterService.limit({
				key: 'signin',
				duration: 60 * 60 * 1000,
				max: 10,
				minInterval: 1000,
			}, getIpHash(request.ip));

			if (rateLimit != null) {
				reply.code(429);
				return {
					error: {
						message: 'Too many failed attempts to sign in. Try again later.',
						code: 'TOO_MANY_AUTHENTICATION_FAILURES',
						id: '22d05606-fbcf-421a-a2db-b32610dcfd1b',
					},
				};
			}
		}

		if (!('sessionId' in request.body)) {
			return this.handleSigninInit(request as FastifyRequest<{ Body: SigninFlowInitRequest }>, reply);
		} else {
			return this.handleSigninContinue(request as FastifyRequest<{ Body: SigninFlowContinueRequest }>, reply);
		}
	}

	@bindThis
	private async handleSigninInit(_request: FastifyRequest<{ Body: SigninFlowInitRequest }>, reply: FastifyReply) {
		const sessionId = secureRndstr(32);
		const passkeyOptions = await this.webAuthnService.initiateAnonymousAuthentication(sessionId);

		const signinData: SigninData = {
			id: null,
			config: null,
			result: {
				password: false,
				totp: false,
				passkey: false,
			},
		};

		// セッションIDとサインインの状態をRedisに保存
		// 有効期限90秒、サインインオプションを一つ通過するごとにこの秒数はリセットされるので短めでも大丈夫
		this.redisClient.setex(`signin:${sessionId}`, 90, JSON.stringify(signinData));

		return {
			sessionId,
			passkeyOptions,
		} satisfies SigninFlowInitResponse;
	}

	@bindThis
	private async handleSigninContinue(request: FastifyRequest<{ Body: SigninFlowContinueRequest }>, reply: FastifyReply) {
		function error(status: number, error: { id: string }) {
			reply.code(status);
			return { error };
		}

		const { sessionId } = request.body;

		const signinDataStr = await this.redisClient.get(`signin:${sessionId}`);
		if (signinDataStr == null) {
			return error(400, {
				id: 'd9c8b1c7-5a3e-4c9b-9a1d-2f0c8e5f6a7b',
			});
		}

		const signinData: SigninData = JSON.parse(signinDataStr);

		let individualResult: SigninIndvidualResult;

		if ('username' in request.body) {
			individualResult = await this.handleSigninUsername(signinData, request.body);
		}

		// これ以降のステップでユーザー名が確定していないことはありえない
		if (!isSigninDataWithUser(signinData)) {
			return error(500, {
				id: '4e30e80c-e338-45a0-8c8f-44455efa3b76',
			});
		}

		if ('password' in request.body) {
			individualResult = await this.handleSigninPassword(signinData, request.body);
		} else if ('passkeyCredential' in request.body) {
			individualResult = await this.handleSigninPasskey(signinData, request.body);
		} else if ('totp' in request.body) {
			individualResult = await this.handleSigninTotp(signinData, request.body);
		} else {
			return error(500, {
				id: '4e30e80c-e338-45a0-8c8f-44455efa3b76',
			});
		}

		if (!individualResult.success) {
			await this.signinsRepository.insert({
				id: this.idService.gen(),
				userId: signinData.id,
				ip: request.ip,
				headers: request.headers as any,
				success: false,
			});

			return error(individualResult.error?.code ?? 500, {
				id: individualResult.error?.id ?? '4e30e80c-e338-45a0-8c8f-44455efa3b76',
			});
		} else {
			const nextStep = computeNextSigninStep(signinData);

			if (nextStep === null) {
				return await this.handleSigninSuccess(signinData, request);
			} else {
				// Redisに保存するサインインの状態を更新
				this.redisClient.setex(`signin:${sessionId}`, 90, JSON.stringify(signinData));

				if (nextStep === 'passkey') {
					const passkeyOptions = await this.webAuthnService.initiateAuthentication(signinData.id);
					return {
						next: 'passkey',
						passkeyOptions,
					} satisfies SigninFlowContinueResponse;
				} else {
					return {
						next: nextStep,
					} satisfies SigninFlowContinueResponse;
				}
			}
		}
	}

	/**
	 * ユーザー名の入力を処理する
	 */
	@bindThis
	private async handleSigninUsername(signinData: SigninData, request: SigninFlowContinueRequestUsername): Promise<SigninIndvidualResult> {
		const { username, captchaResponse } = request;

		if (captchaResponse && process.env.NODE_ENV !== 'test') {
			switch (captchaResponse.type) {
				case 'hcaptcha':
					if (this.meta.enableHcaptcha && this.meta.hcaptchaSecretKey) {
						await this.captchaService.verifyHcaptcha(this.meta.hcaptchaSecretKey, captchaResponse.response).catch(err => {
							throw new FastifyReplyError(400, err);
						});
					}
					break;

				case 'recaptcha-v2':
					if (this.meta.enableRecaptcha && this.meta.recaptchaSecretKey) {
						await this.captchaService.verifyRecaptcha(this.meta.recaptchaSecretKey, captchaResponse.response).catch(err => {
							throw new FastifyReplyError(400, err);
						});
					}
					break;

				case 'turnstile':
					if (this.meta.enableTurnstile && this.meta.turnstileSecretKey) {
						await this.captchaService.verifyTurnstile(this.meta.turnstileSecretKey, captchaResponse.response).catch(err => {
							throw new FastifyReplyError(400, err);
						});
					}
					break;

				case 'mcaptcha':
					if (this.meta.enableMcaptcha && this.meta.mcaptchaSecretKey && this.meta.mcaptchaSitekey && this.meta.mcaptchaInstanceUrl) {
						await this.captchaService.verifyMcaptcha(this.meta.mcaptchaSecretKey, this.meta.mcaptchaSitekey, this.meta.mcaptchaInstanceUrl, captchaResponse.response).catch(err => {
							throw new FastifyReplyError(400, err);
						});
					}
					break;

				case 'testcaptcha':
					if (this.meta.enableTestcaptcha) {
						await this.captchaService.verifyTestcaptcha(captchaResponse.response).catch(err => {
							throw new FastifyReplyError(400, err);
						});
					}
					break;
			}
		}

		const user = await this.usersRepository.findOneBy({
			usernameLower: username.toLowerCase(),
			host: IsNull(),
		});

		if (user == null) {
			return {
				success: false,
				error: {
					id: '6cc579cc-885d-43d8-95c2-b8c7fc963280',
					code: 404,
				},
			};
		}

		if (user.isSuspended) {
			return {
				success: false,
				error: {
					id: 'e03a5f46-d309-4865-9b69-56282d94e1eb',
					code: 403,
				},
			};
		}

		const userProfile = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });
		const securityKeysAvailable = await this.userSecurityKeysRepository.countBy({ userId: user.id }).then(result => result >= 1);

		signinData.id = user.id;
		signinData.config = {
			totp: userProfile.twoFactorEnabled,
			passkey: securityKeysAvailable,
			passkeyPasswordless: securityKeysAvailable && userProfile.usePasswordLessLogin,
		};

		return {
			success: true,
		};
	}

	/**
	 * パスワードの入力を処理する
	 */
	@bindThis
	private async handleSigninPassword(signinData: SigninDataWithUser, request: SigninFlowContinueRequestPassword): Promise<SigninIndvidualResult> {
		const { password } = request;
		const profile = await this.userProfilesRepository.findOneByOrFail({ userId: signinData.id });

		if (profile.password == null) {
			return {
				success: false,
				error: {
					id: 'df7241ad-7c1b-4ca8-bd01-337be638ace9', // NOTE: new
					code: 400,
				},
			};
		}

		const same = await bcrypt.compare(password, profile.password);

		if (same) {
			signinData.result.password = true;
			return {
				success: true,
			};
		} else {
			return {
				success: false,
				error: {
					id: '932c904e-9460-45b7-9ce6-7ed33be7eb2c',
					code: 403,
				},
			};
		}
	}

	/**
	 * パスキーの入力を処理する
	 */
	@bindThis
	private async handleSigninPasskey(signinData: SigninDataWithUser, request: SigninFlowContinueRequestPasskey): Promise<SigninIndvidualResult> {
		const { passkeyCredential } = request;

		try {
			await this.webAuthnService.verifyAuthentication(signinData.id, passkeyCredential);
			signinData.result.passkey = true;
			return {
				success: true,
			};
		} catch (_) {
			return {
				success: false,
				error: {
					id: '932c904e-9460-45b7-9ce6-7ed33be7eb2c',
					code: 403,
				},
			};
		}
	}

	/**
	 * TOTPの入力を処理する
	 */
	@bindThis
	private async handleSigninTotp(signinData: SigninDataWithUser, request: SigninFlowContinueRequestTotp): Promise<SigninIndvidualResult> {
		const { totp } = request;

		try {
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: signinData.id });
			await this.totpService.twoFactorAuthenticate(profile, totp);
			signinData.result.totp = true;
			return {
				success: true,
			};
		} catch (_) {
			return {
				success: false,
				error: {
					id: '932c904e-9460-45b7-9ce6-7ed33be7eb2c',
					code: 403,
				},
			};
		}
	}

	@bindThis
	private async handleSigninSuccess(signinData: SigninDataWithUser, request: FastifyRequest) {
		setImmediate(async () => {
			this.notificationService.createNotification(signinData.id, 'login', {});

			const record = await this.signinsRepository.insertOne({
				id: this.idService.gen(),
				userId: signinData.id,
				ip: request.ip,
				headers: request.headers as any,
				success: true,
			});

			this.globalEventService.publishMainStream(signinData.id, 'signin', await this.signinEntityService.pack(record));

			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: signinData.id });
			if (profile.email && profile.emailVerified) {
				this.emailService.sendEmail(profile.email, 'New login / ログインがありました',
					'There is a new login. If you do not recognize this login, update the security status of your account, including changing your password. / 新しいログインがありました。このログインに心当たりがない場合は、パスワードを変更するなど、アカウントのセキュリティ状態を更新してください。',
					'There is a new login. If you do not recognize this login, update the security status of your account, including changing your password. / 新しいログインがありました。このログインに心当たりがない場合は、パスワードを変更するなど、アカウントのセキュリティ状態を更新してください。');
			}
		});

		const user = await this.usersRepository.findOneByOrFail({ id: signinData.id });
		const token = await this.authenticateService.generateNativeTokens(user);

		return {
			id: signinData.id,
			accessToken: token.accessToken,
			refreshToken: token.refreshToken,
		};
	}
}
