/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';
import { DI } from '@/di-symbols.js';
import { CacheService } from '@/core/CacheService.js';
import type { Config } from '@/config.js';
import type { AccessTokensRepository, AppsRepository, UsersRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiAccessToken } from '@/models/AccessToken.js';
import { bindThis } from '@/decorators.js';

const ACCESS_TOKEN_SUBJECT = 'a';
const REFRESH_TOKEN_SUBJECT = 'r';

type JwtPayload = {
	id: MiLocalUser['id'];
	isSuspended: boolean;
	movedToUri: string | null;
	sudo: boolean;
};

export type MiJwt = {
	id: MiLocalUser['id'];
	isSuspended: boolean;
	movedToUri: string | null;
};

type UserForTokenGeneration = {
	id: MiLocalUser['id'];
	isSuspended: MiLocalUser['isSuspended'];
	movedToUri: MiLocalUser['movedToUri'];
	token: MiLocalUser['token'];
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
	public async generateNativeAccessToken(user: UserForTokenGeneration, sudoMode = false): Promise<string> {
		if (user.token == null) {
			throw new Error('User does not have a token');
		}

		const jwt = new SignJWT({
			id: user.id,
			sudo: sudoMode,
			isSuspended: user.isSuspended,
			movedToUri: user.movedToUri,
		})
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('15m')
			.setJti(user.token)
			.setSubject(ACCESS_TOKEN_SUBJECT)
			.sign(this.privateKey);

		return jwt;
	}

	@bindThis
	public async generateNativeRefreshToken(user: UserForTokenGeneration): Promise<string> {
		if (user.token == null) {
			throw new Error('User does not have a token');
		}

		const jwt = new SignJWT({ id: user.id })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('14d')
			.setJti(user.token!)
			.setSubject(REFRESH_TOKEN_SUBJECT)
			.sign(this.privateKey);

		return jwt;
	}

	@bindThis
	public async generateNativeTokens(user: UserForTokenGeneration): Promise<{ accessToken: string; refreshToken: string }> {
		const [accessToken, refreshToken] = await Promise.all([
			this.generateNativeAccessToken(user),
			this.generateNativeRefreshToken(user),
		]);

		return { accessToken, refreshToken };
	}

	@bindThis
	public async verifyNativeAccessToken(accessToken: string): Promise<JwtPayload | null> {
		try {
			const { payload } = await jwtVerify(accessToken, this.privateKey, {
				subject: ACCESS_TOKEN_SUBJECT,
				clockTolerance: 5,
				requiredClaims: ['jti'],
			});

			if (
				typeof payload.id !== 'string' ||
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
				id: payload.id,
				sudo: !!payload.sudo,
				isSuspended: !!payload.isSuspended,
				movedToUri: payload.movedToUri,
			};
		} catch (e) {
			return null;
		}
	}

	@bindThis
	public async regenerateNativeAccessToken(refreshToken: string): Promise<string | null> {
		try {
			const { payload } = await jwtVerify(refreshToken, this.privateKey, {
				subject: REFRESH_TOKEN_SUBJECT,
				clockTolerance: 5,
				requiredClaims: ['jti'],
			});

			if (typeof payload.id !== 'string' || typeof payload.jti !== 'string') {
				return null;
			}

			// マスターのトークン（JTI）がローテートされていないか確認する
			const user = await this.usersRepository.findOneBy({ token: payload.jti });
			if (!user || user.id !== payload.id) {
				return null;
			}

			return this.generateNativeAccessToken({
				id: payload.id,
				isSuspended: user.isSuspended,
				movedToUri: user.movedToUri,
				token: payload.jti,
			});
		} catch (e) {
			return null;
		}
	}

	@bindThis
	public async authenticate(token: string | null | undefined): Promise<{
		user: MiJwt | null;
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
					id: jwt.id,
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
						isSuspended: accessToken.user?.isSuspended ?? false,
						movedToUri: accessToken.user?.movedToUri ?? null,
					},
					sudo: false,
					accessToken,
				};
			}
		}

		return {
			user: null,
			sudo: false,
			accessToken: null,
		};
	}
}
