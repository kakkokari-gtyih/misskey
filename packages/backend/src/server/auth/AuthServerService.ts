/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { bindThis } from '@/decorators.js';
import { Injectable } from '@nestjs/common';
import { AuthenticateService } from '@/server/auth/AuthenticateService.js';
import { SigninApiService } from '@/server/auth/SigninApiService.js';
import { SignupApiService } from '@/server/auth/SignupApiService.js';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class AuthServerService {
	constructor(
		private autenticateService: AuthenticateService,
		private signinApiService: SigninApiService,
		private signupApiService: SignupApiService,
	) {
	}

	@bindThis
	public createServer(fastify: FastifyInstance, _options: FastifyPluginOptions, done: (err?: Error) => void) {
		// Prevent cache
		fastify.addHook('onRequest', (_request, reply, done) => {
			reply.header('Cache-Control', 'no-store');
			done();
		});

		fastify.post('/signin', (request, reply) => this.signinApiService.signinRequestHandler(request as FastifyRequest<any>, reply));
		fastify.post('/signup', (request, reply) => this.signupApiService.signupRequestHandler(request as FastifyRequest<any>, reply));
		fastify.post('/signup-pending', (request, reply) => this.signupApiService.signupPending(request as FastifyRequest<any>, reply));
		fastify.post('/refresh-token', (request, reply) => this.refreshTokenRequestHandler(request as FastifyRequest<any>, reply));

		done();
	}

	@bindThis
	private refreshTokenRequestHandler(request: FastifyRequest<{ Body: { refreshToken: string } }>, reply: FastifyReply) {
		const accessToken = this.autenticateService.regenerateNativeAccessToken(request.body.refreshToken);
		return {

		};
	}
}
