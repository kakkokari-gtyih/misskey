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

const ACCESS_TOKEN_SUBJECT = 'a';
const REFRESH_TOKEN_SUBJECT = 'r';

export type MiJwt = {
	id: MiLocalUser['id'];
};

type UserForTokenGeneration = {
	id: MiLocalUser['id'];
	token: MiLocalUser['token'];
};

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

	private async getUserIdByNativeToken(nativeToken: string): Promise<MiLocalUser['id'] | null> {
		return (await this.cacheService.localUserIdByNativeTokenCache.fetchMaybe(nativeToken, () => this.usersRepository.findOneBy({ token: nativeToken }).then(user => user?.id))) ?? null;
	}

	public async generateNativeAccessToken(user: UserForTokenGeneration): Promise<string> {
		const jwt = new SignJWT({ id: user.id })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('15m')
			.setJti(user.token!)
			.setSubject(ACCESS_TOKEN_SUBJECT)
			.sign(this.privateKey);

		return jwt;
	}

	public async generateNativeRefreshToken(user: UserForTokenGeneration): Promise<string> {
		const jwt = new SignJWT({ id: user.id })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('14d')
			.setJti(user.token!)
			.setSubject(REFRESH_TOKEN_SUBJECT)
			.sign(this.privateKey);

		return jwt;
	}

	public async generateNativeTokens(user: UserForTokenGeneration): Promise<{ accessToken: string; refreshToken: string }> {
		const [accessToken, refreshToken] = await Promise.all([
			this.generateNativeAccessToken(user),
			this.generateNativeRefreshToken(user),
		]);

		return { accessToken, refreshToken };
	}

	public async verifyNativeAccessToken(accessToken: string): Promise<MiJwt | null> {
		try {
			const { payload } = await jwtVerify(accessToken, this.privateKey, {
				subject: ACCESS_TOKEN_SUBJECT,
				clockTolerance: 5,
				requiredClaims: ['jti'],
			});

			if (typeof payload.id !== 'string' || typeof payload.jti !== 'string') {
				return null;
			}

			// マスターのトークン（JTI）がローテートされていないか確認する
			const userId = await this.getUserIdByNativeToken(payload.jti);
			if (userId !== payload.id) {
				return null;
			}

			return { id: payload.id };
		} catch (e) {
			return null;
		}
	}

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

			const userId = await this.getUserIdByNativeToken(payload.jti);
			if (userId !== payload.id) {
				return null;
			}

			return this.generateNativeAccessToken({ id: payload.id, token: payload.jti });
		} catch (e) {
			return null;
		}
	}

	public async authenticate(token: string | null | undefined): Promise<[MiJwt | null, MiAccessToken | null]> {
		if (token == null) {
			return [null, null];
		}

		// まずはJWTとして検証してみる
		const jwt = await this.verifyNativeAccessToken(token);
		if (jwt) {
			return [{ id: jwt.id }, null];
		}

		// JWTでなければ、サードパーティのアクセストークンを探す
		const accessToken = await this.accessTokensRepository.findOneBy({ token });
		if (accessToken) {
			if (accessToken.appId) {
				const app = await this.appsRepository.findOneByOrFail({ id: accessToken.appId });
				return [{ id: accessToken.userId }, {
					id: accessToken.id,
					permission: app.permission,
				} as MiAccessToken];
			} else {
				return [{ id: accessToken.userId }, accessToken];
			}
		}

		return [null, null];
	}
}
