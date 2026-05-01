/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';
import { compactVerify } from 'jose/jws/compact/verify';
import { bindThis } from '@/decorators.js';
import { DI } from '@/di-symbols.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { CacheService } from '@/core/CacheService.js';
import type { Config } from '@/config.js';
import type { AccessTokensRepository, AppsRepository, MiSignin, SigninsRepository, UsersRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiAccessToken } from '@/models/AccessToken.js';

const ACCESS_TOKEN_SUBJECT = 'a';
const REFRESH_TOKEN_SUBJECT = 'r';

type JwtAccessTokenPayload = {
	userId: MiLocalUser['id'];
	sessionId: MiSignin['id'];
	isSuspended: boolean;
	movedToUri: string | null;
	sudo: boolean;
};

type JwtRefreshTokenPayload = {
	userId: MiLocalUser['id'];
	sessionId: MiSignin['id'];
};

export type MiJwtUser = {
	id: MiLocalUser['id'];
	host: null;
	isSuspended: boolean;
	movedToUri: string | null;
};

type UserForTokenGeneration = {
	id: MiLocalUser['id'];
	isSuspended: MiLocalUser['isSuspended'];
	movedToUri: MiLocalUser['movedToUri'];
	token: MiLocalUser['token'];
};

type SessionForTokenGeneration = {
	id: MiSignin['id'];
	refreshToken: MiSignin['refreshToken'];
};

export class AuthenticationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthenticationError';
	}
}

@Injectable()
export class AuthenticateService {
	private privateKey: Uint8Array;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,

		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,

		private cacheService: CacheService,
	) {
		this.privateKey = new TextEncoder().encode(this.config.tokenSecret);
	}

	@bindThis
	private async getUserIdByNativeToken(nativeToken: string): Promise<MiLocalUser['id'] | null> {
		return (await this.cacheService.localUserIdByNativeTokenCache.fetchMaybe(nativeToken, () => this.usersRepository.findOneBy({ token: nativeToken }).then(user => user?.id))) ?? null;
	}

	@bindThis
	public async generateNativeAccessToken(user: UserForTokenGeneration, sessionId: MiSignin['id'], sudoMode = false, now?: string | number | Date | undefined): Promise<string> {
		if (user.token == null) {
			throw new Error('User does not have a token');
		}

		const jwt = new SignJWT({
			id: user.id,
			sessionId,
			sudo: sudoMode,
			isSuspended: user.isSuspended,
			movedToUri: user.movedToUri,
		})
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt(now)
			.setExpirationTime('15m')
			.setJti(user.token)
			.setSubject(ACCESS_TOKEN_SUBJECT)
			.sign(this.privateKey);

		return jwt;
	}

	@bindThis
	public async generateNativeRefreshToken(user: UserForTokenGeneration, session: SessionForTokenGeneration, now?: string | number | Date | undefined): Promise<string> {
		if (user.token == null) {
			throw new Error('User does not have a token');
		}

		if (session.refreshToken == null) {
			throw new Error('Session does not have a refresh token');
		}

		const jwt = new SignJWT({
			userId: user.id,
			sessionId: session.id,
		})
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt(now)
			.setExpirationTime('7d')
			.setJti(session.refreshToken)
			.setSubject(REFRESH_TOKEN_SUBJECT)
			.sign(this.privateKey);

		return jwt;
	}

	@bindThis
	public async generateNativeTokens(user: UserForTokenGeneration, session: SessionForTokenGeneration, sudoMode = false, now: string | number | Date = Date.now()): Promise<{ accessToken: string; refreshToken: string; }> {
		const [accessToken, refreshToken] = await Promise.all([
			this.generateNativeAccessToken(user, session.id, sudoMode, now),
			this.generateNativeRefreshToken(user, session, now),
		]);

		return {
			accessToken,
			refreshToken,
		};
	}

	@bindThis
	public async verifyNativeAccessToken(accessToken: string): Promise<JwtAccessTokenPayload | null> {
		try {
			const { payload } = await jwtVerify(accessToken, this.privateKey, {
				subject: ACCESS_TOKEN_SUBJECT,
				clockTolerance: 5,
				requiredClaims: ['jti'],
			});

			if (
				typeof payload.userId !== 'string' ||
				typeof payload.sessionId !== 'string' ||
				typeof payload.jti !== 'string' ||
				typeof payload.isSuspended !== 'boolean' ||
				typeof payload.sudo !== 'boolean' ||
				(payload.movedToUri !== null && typeof payload.movedToUri !== 'string')
			) {
				return null;
			}

			// マスターのトークン（JTI）がローテートされていないか確認する
			const userId = await this.getUserIdByNativeToken(payload.jti);
			if (userId !== payload.id) {
				return null;
			}

			return {
				userId: payload.userId,
				sessionId: payload.sessionId,
				sudo: !!payload.sudo,
				isSuspended: !!payload.isSuspended,
				movedToUri: payload.movedToUri,
			};
		} catch (e) {
			return null;
		}
	}

	@bindThis
	public async refreshNativeAccessToken(expiredAccessToken: string, jwtRefreshToken: string): Promise<{ accessToken: string; refreshToken: string; } | null> {
		try {
			// jwtVerifyは有効期限切れのトークンに対してはエラーを投げるため、compactVerifyで署名検証＋ペイロード取り出しのみを行う
			const verifiedExpiredAccessToken = await compactVerify(expiredAccessToken, this.privateKey);
			if (verifiedExpiredAccessToken.protectedHeader.crit?.includes('b64') && verifiedExpiredAccessToken.protectedHeader.b64 === false) {
				// JWTs MUST NOT use unencoded payload
				return null;
			}
			const expiredAccessTokenPayload = JSON.parse(new TextDecoder().decode(verifiedExpiredAccessToken.payload));

			const refreshTokenPayload = await jwtVerify(jwtRefreshToken, this.privateKey, {
				subject: REFRESH_TOKEN_SUBJECT,
				clockTolerance: 5,
				requiredClaims: ['jti'],
			}).then(result => result.payload);

			if (
				typeof refreshTokenPayload.userId !== 'string' ||
				typeof refreshTokenPayload.sessionId !== 'string' ||
				typeof refreshTokenPayload.jti !== 'string'
			) {
				return null;
			}

			// リフレッシュトークンに対応するサインインがあるか探す（signin idで調べないのは、リフレッシュトークンがローテートされている可能性があるため）
			const query = this.signinsRepository.createQueryBuilder('signin')
				.where('signin.refreshToken = :refreshToken', { refreshToken: refreshTokenPayload.jti })
				.innerJoinAndSelect('signin.user', 'user');

			const signin = await query.getOne();

			if (!signin || !signin.user) {
				return null;
			}

			// マスターのトークン（JTI）がローテートされていないか確認する
			if (signin.user.token !== expiredAccessTokenPayload.jti) {
				return null;
			}

			// アクセストークンのsessionIdとリフレッシュトークンのsessionIdが一致するか確認する
			if (expiredAccessTokenPayload.sessionId !== refreshTokenPayload.sessionId) {
				return null;
			}

			// リフレッシュトークンをローテート
			const newRefreshToken = secureRndstr(64);
			await this.signinsRepository.update(signin.id, {
				refreshToken: newRefreshToken,
			});

			return await this.generateNativeTokens({
				id: signin.user.id,
				isSuspended: signin.user.isSuspended,
				movedToUri: signin.user.movedToUri,
				token: signin.user.token,
			}, {
				id: signin.id,
				refreshToken: newRefreshToken,
			});
		} catch (e) {
			return null;
		}
	}

	@bindThis
	public async authenticate(token: string | null | undefined): Promise<{
		user: MiJwtUser | null;
		sudo: boolean;
		accessToken: MiAccessToken | null;
	}> {
		if (token == null) {
			return {
				user: null,
				sudo: false,
				accessToken: null,
			};
		}

		// まずはJWTとして検証してみる
		const jwt = await this.verifyNativeAccessToken(token);
		if (jwt) {
			return {
				user: {
					id: jwt.userId,
					host: null,
					isSuspended: jwt.isSuspended,
					movedToUri: jwt.movedToUri,
				},
				sudo: jwt.sudo,
				accessToken: null,
			};
		}

		// JWTでなければ、サードパーティのアクセストークンを探す
		const accessToken = await this.accessTokensRepository.findOneBy({ token });
		if (accessToken) {
			if (accessToken.appId) {
				const app = await this.appsRepository.findOneByOrFail({ id: accessToken.appId });
				return {
					user: {
						id: accessToken.userId,
						host: null,
						isSuspended: accessToken.user?.isSuspended ?? false,
						movedToUri: accessToken.user?.movedToUri ?? null,
					},
					sudo: false,
					accessToken: ({
						id: accessToken.id,
						permissions: app.permission,
					} as unknown as MiAccessToken),
				};
			} else {
				return {
					user: {
						id: accessToken.userId,
						host: null,
						isSuspended: accessToken.user?.isSuspended ?? false,
						movedToUri: accessToken.user?.movedToUri ?? null,
					},
					sudo: false,
					accessToken,
				};
			}
		}

		throw new AuthenticationError('Invalid token');
	}
}
