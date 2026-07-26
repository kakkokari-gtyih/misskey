/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import Parser from 'rss-parser';
import { Injectable } from '@nestjs/common';
import * as v from 'valibot';
import * as mi from '@/misc/schema/index.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';

const rssParser = new Parser();

export const meta = {
	tags: ['meta'],

	requireCredential: false,
	allowGet: true,
	cacheSec: 60 * 3,

	res: v.object({
		image: v.optional(v.object({
			link: v.optional(v.string()),
			url: v.string(),
			title: v.optional(v.string()),
		})),
		paginationLinks: v.optional(v.object({
			self: v.optional(v.string()),
			first: v.optional(v.string()),
			next: v.optional(v.string()),
			last: v.optional(v.string()),
			prev: v.optional(v.string()),
		})),
		link: v.optional(v.string()),
		title: v.optional(v.string()),
		items: v.array(v.object({
			link: v.optional(v.string()),
			guid: v.optional(v.string()),
			title: v.optional(v.string()),
			pubDate: v.optional(v.string()),
			creator: v.optional(v.string()),
			summary: v.optional(v.string()),
			content: v.optional(v.string()),
			isoDate: v.optional(v.string()),
			categories: v.optional(v.array(v.string())),
			contentSnippet: v.optional(v.string()),
			enclosure: v.optional(v.object({
				url: v.string(),
				length: v.optional(v.number()),
				type: v.optional(v.string()),
			})),
		})),
		feedUrl: v.optional(v.string()),
		description: v.optional(v.string()),
		itunes: v.optional(v.pipe(
			v.object({
				image: v.optional(v.string()),
				owner: v.optional(v.object({
					name: v.optional(v.string()),
					email: v.optional(v.string()),
				})),
				author: v.optional(v.string()),
				summary: v.optional(v.string()),
				explicit: v.optional(v.string()),
				categories: v.optional(v.array(v.string())),
				keywords: v.optional(v.array(v.string())),
			}),
			mi.openApi({ additionalProperties: true }),
		)),
	}),
} as const;

export const paramDef = v.object({
	url: v.string(),
});

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private httpRequestService: HttpRequestService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const res = await this.httpRequestService.send(ps.url, {
				method: 'GET',
				headers: {
					Accept: 'application/rss+xml, */*',
				},
				timeout: 5000,
			});

			const text = await res.text();

			return rssParser.parseString(text);
		});
	}
}
