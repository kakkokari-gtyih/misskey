/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { SummalyResult } from '@misskey-dev/summaly';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import type Logger from '@/logger.js';
import { deepClone } from '@/misc/clone.js';
import { query } from '@/misc/prelude/url.js';
import { MemoryKVCache } from '@/misc/cache.js';
import { LoggerService } from '@/core/LoggerService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { bindThis } from '@/decorators.js';
import { MiMeta } from '@/models/Meta.js';

@Injectable()
export class UrlPreviewService implements OnApplicationShutdown {
	private logger: Logger;
	private summaryCache: MemoryKVCache<SummalyResult>;
	private readonly summalyDefaultUserAgent: string;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		private httpRequestService: HttpRequestService,
		private utilityService: UtilityService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('url-preview');
		this.summaryCache = new MemoryKVCache<SummalyResult>(1000 * 60 * 60, 200); // 1h, 100件
		this.summalyDefaultUserAgent = `SummalyBot/${_SUMMALY_VERSION_} (${this.config.url}; +https://github.com/misskey-dev/summaly/blob/master/README.md)`;
	}

	@bindThis
	private wrap(url?: string | null): string | null {
		return url != null
			? `${this.config.mediaProxy}/preview.webp?${query({
				url,
				preview: '1',
			})}`
			: null;
	}

	@bindThis
	public async getPreview(url: string, lang?: string): Promise<SummalyResult | null> {
		if (!this.meta.urlPreviewEnabled) {
			return null;
		}

		this.logger.info(this.meta.urlPreviewSummaryProxyUrl
			? `(Proxy) Getting preview of ${url}@${lang} ...`
			: `Getting preview of ${url}@${lang} ...`);

		try {
			const fetcher = async () => {
				const result = await (
					this.meta.urlPreviewSummaryProxyUrl
					? this.fetchSummaryFromProxy(url, lang)
					: this.fetchSummary(url, lang)
				);

				if (!result.url.startsWith('http://') && !result.url.startsWith('https://')) {
					return undefined;
				}

				if (result.player.url && !result.player.url.startsWith('http://') && !result.player.url.startsWith('https://')) {
					return undefined;
				}

				return result;
			};

			const summary = deepClone(await this.summaryCache.fetchMaybe(`${url}@${lang ?? '_DEFAULT_'}`, fetcher));

			if (summary == null) {
				throw new Error('Invalid summary');
			}

			this.logger.succ(`Got preview of ${url}: ${summary.title}`);

			summary.icon = this.wrap(summary.icon);
			summary.thumbnail = this.wrap(summary.thumbnail);

			if (summary.sensitive !== true) {
				summary.sensitive = this.utilityService.isKeyWordIncluded(summary.url, this.meta.urlPreviewSensitiveList);
			}

			return summary;
		} catch (err) {
			this.logger.warn(`Failed to get preview of ${url}: ${err}`);

			return null;
		}
	}

	@bindThis
	private async fetchSummary(url: string, lang?: string): Promise<SummalyResult> {
		const { summaly } = await import('@misskey-dev/summaly');

		return summaly(url, {
			followRedirects: this.meta.urlPreviewAllowRedirect,
			lang: lang ?? 'ja-JP',
			agent: {
				http: this.httpRequestService.httpAgent,
				https: this.httpRequestService.httpsAgent,
			},
			userAgent: this.meta.urlPreviewUserAgent ?? this.summalyDefaultUserAgent,
			operationTimeout: this.meta.urlPreviewTimeout,
			contentLengthLimit: this.meta.urlPreviewMaximumContentLength,
			contentLengthRequired: this.meta.urlPreviewRequireContentLength,
		});
	}

	@bindThis
	private fetchSummaryFromProxy(url: string, lang?: string): Promise<SummalyResult> {
		const proxy = this.meta.urlPreviewSummaryProxyUrl!;
		const queryStr = query({
			url: url,
			lang: lang ?? 'ja-JP',
			followRedirects: this.meta.urlPreviewAllowRedirect,
			userAgent: this.meta.urlPreviewUserAgent ?? this.summalyDefaultUserAgent,
			operationTimeout: this.meta.urlPreviewTimeout,
			contentLengthLimit: this.meta.urlPreviewMaximumContentLength,
			contentLengthRequired: this.meta.urlPreviewRequireContentLength,
		});

		return this.httpRequestService.getJson<SummalyResult>(`${proxy}?${queryStr}`, 'application/json, */*', undefined, true);
	}

	@bindThis
	public dispose(): void {
		this.summaryCache.dispose();
	}

	@bindThis
	public onApplicationShutdown(): void {
		this.dispose();
	}
}
