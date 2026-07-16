/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { UrlPreviewService } from '@/core/UrlPreviewService.js';
import { bindThis } from '@/decorators.js';
import { ApiError } from '@/server/api/error.js';
import { MiMeta } from '@/models/Meta.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class UrlPreviewServerService {
	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		private urlPreviewService: UrlPreviewService,
	) {
	}

	@bindThis
	public async handle(
		request: FastifyRequest<{ Querystring: { url: string; lang?: string; } }>,
		reply: FastifyReply,
	): Promise<object | undefined> {
		const url = request.query.url;
		if (typeof url !== 'string') {
			reply.code(400);
			return;
		}

		const lang = request.query.lang;
		if (Array.isArray(lang)) {
			reply.code(400);
			return;
		}

		if (!this.meta.urlPreviewEnabled) {
			reply.code(403);
			return {
				error: new ApiError({
					message: 'URL preview is disabled',
					code: 'URL_PREVIEW_DISABLED',
					id: '58b36e13-d2f5-0323-b0c6-76aa9dabefb8',
				}),
			};
		}

		try {
			const res = await this.urlPreviewService.getPreview(url, lang);

			if (res == null) {
				throw new Error('Failed to get preview');
			}

			// Cache 1day
			reply.header('Cache-Control', 'max-age=86400, immutable');

			return res;
		} catch (err) {
			reply.code(422);
			reply.header('Cache-Control', 'max-age=86400, immutable');
			return {
				error: new ApiError({
					message: 'Failed to get preview',
					code: 'URL_PREVIEW_FAILED',
					id: '09d01cb5-53b9-4856-82e5-38a50c290a3b',
				}),
			};
		}
	}
}
