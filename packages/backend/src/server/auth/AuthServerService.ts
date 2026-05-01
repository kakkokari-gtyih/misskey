/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { bindThis } from '@/decorators.js';
import { Injectable } from '@nestjs/common';
import { SigninApiService } from '@/server/auth/SigninApiService.js';
import { SignupApiService } from '@/server/auth/SignupApiService.js';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';

@Injectable()
export class AuthServerService {
	constructor(
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

		done();
	}
}
