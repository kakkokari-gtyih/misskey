/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Buffer } from 'node:buffer';
import { routePath } from 'hono/route';
import { logManager } from '@/logging/logging-runtime.js';
import type { LogManager } from '@/logging/LogManager.js';
import type { LogTraceContext } from '@/logging/types.js';
import type { Context, Hono } from 'hono';
import type { ApiEnv } from './api/ApiServerTypes.js';

type CapturedBody = {
	value: unknown;
};

type AccessLogParams = {
	statusCode: number;
	durationMs: number;
	response: Response | null;
	ownRouteIndex: number;
	errorType?: string;
	traceContext?: LogTraceContext;
};

/** Content-Typeから本文の種類だけを取り出します。 */
function getMediaType(value: string | null | undefined): string | undefined {
	return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : undefined;
}

/** 秘匿処理を適用できるJSON・form・text本文か判定します。 */
function isSupportedMediaType(value: string | undefined): boolean {
	return value === 'application/json'
		|| (value?.startsWith('application/') === true && value.endsWith('+json'))
		|| value === 'application/x-www-form-urlencoded'
		|| (value?.startsWith('text/') === true && value !== 'text/event-stream');
}

/** application/jsonとapplication/*+jsonを構造化対象として判定します。 */
function isJsonMediaType(value: string | undefined): boolean {
	return value === 'application/json'
		|| (value?.startsWith('application/') === true && value.endsWith('+json'));
}

/** JSON文字列を構造化し、解析できない場合は元の文字列を保持します。 */
function parseJsonBody(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/** form本文を項目ごとの値へ分解し、キー単位の秘匿処理を可能にします。 */
function parseFormBody(value: string): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = Object.create(null) as Record<string, string | string[]>;
	for (const [key, item] of new URLSearchParams(value)) {
		const previous = result[key];
		result[key] = typeof previous === 'undefined'
			? item
			: Array.isArray(previous) ? [...previous, item] : [previous, item];
	}
	return result;
}

/** 読み取った本文を、Content-Typeに応じてログへ渡せる値へ変換します。 */
function captureBody(text: string, mediaType: string | undefined): CapturedBody {
	if (isJsonMediaType(mediaType)) return { value: parseJsonBody(text) };
	if (mediaType === 'application/x-www-form-urlencoded') return { value: parseFormBody(text) };
	return { value: text };
}

/**
 * downstreamのhandlerが既に読み取ったリクエスト本文だけをbodyCacheから取り出します。
 * リクエストのstreamには触れないため、handlerが本文を読まない経路では何も記録しません。
 * bodyCacheは型定義上は解析後の値ですが、実際にはその値のPromiseを保持しています。
 */
async function readRequestBody(ctx: Context<ApiEnv>): Promise<string | undefined> {
	const cache = ctx.req.bodyCache as { text?: Promise<string>; arrayBuffer?: Promise<ArrayBuffer> };
	try {
		// req.json()はtextを、req.parseBody()はarrayBufferを経由するため、この2つだけを参照します。
		if (cache.text != null) return await cache.text;
		if (cache.arrayBuffer != null) return Buffer.from(await cache.arrayBuffer).toString('utf8');
	} catch {
		// 本文の読み取りに失敗しても、ログ処理が応答へ影響しないよう無視します。
	}
	return undefined;
}

/** 応答本文を複製して読み取り、呼び出し元が返す応答自体は変更しません。 */
async function readResponseBody(response: Response): Promise<string | undefined> {
	try {
		return await response.clone().text();
	} catch {
		// 本文の読み取りに失敗しても、ログ処理が応答へ影響しないよう無視します。
		return undefined;
	}
}

/** Errorから本文を含めない型名だけを取り出します。 */
function getErrorType(error: unknown): string {
	if (typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string') {
		const name = (error as { name: string }).name;
		if (name.length > 0) return name;
	}
	return 'Error';
}

/**
 * 実際に応答を返したルート定義を取り出し、一致するルートが無い場合はnullを返します。
 * routePathは既定でrouteIndex、すなわち応答を返したhandlerのルートを返すため、
 * このmiddleware自身のindexから進んでいなければどのルートにも到達していないと判断します。
 */
function getRoute(ctx: Context<ApiEnv>, ownRouteIndex: number): string | null {
	if (ctx.req.routeIndex <= ownRouteIndex) return null;
	const path = routePath(ctx);
	return path === '' ? null : path;
}

/**
 * content-lengthを安全なバイト数へ変換し、未知の応答ではnullを返します。
 * Web標準のResponseはcontent-lengthを持たないことが多いため、
 * 本文を読み取っている場合はそのバイト数で補います。
 */
function getResponseSize(response: Response | null, body: string | undefined): number | null {
	if (response == null) return null;

	const raw = response.headers.get('content-length');
	if (raw != null) {
		const size = /^\d+$/.test(raw) ? Number(raw) : NaN;
		return Number.isSafeInteger(size) && size >= 0 ? size : null;
	}

	if (body != null) return Buffer.byteLength(body, 'utf8');
	return response.body == null ? 0 : null;
}

/** 応答から必要な値を集め、LogManagerへAccess logを渡します。 */
async function writeAccessLog(manager: LogManager, ctx: Context<ApiEnv>, params: AccessLogParams): Promise<void> {
	if (!manager.shouldWriteAccess(params.statusCode)) return;

	const bodyConfiguration = manager.getAccessLogConfiguration().bodies;
	const response = params.response;

	let requestBody: CapturedBody | undefined;
	if (bodyConfiguration.request) {
		const mediaType = getMediaType(ctx.req.header('content-type'));
		if (isSupportedMediaType(mediaType)) {
			const text = await readRequestBody(ctx);
			if (text != null) requestBody = captureBody(text, mediaType);
		}
	}

	let responseText: string | undefined;
	let responseBody: CapturedBody | undefined;
	if (response != null && bodyConfiguration.response && response.body != null) {
		const mediaType = getMediaType(response.headers.get('content-type'));
		if (isSupportedMediaType(mediaType)) {
			responseText = await readResponseBody(response);
			if (responseText != null) responseBody = captureBody(responseText, mediaType);
		}
	}

	manager.writeAccess({
		method: ctx.req.method,
		route: getRoute(ctx, params.ownRouteIndex),
		statusCode: params.statusCode,
		durationMs: params.durationMs,
		responseSizeBytes: getResponseSize(response, responseText),
		...(params.errorType !== undefined ? { errorType: params.errorType } : {}),
		...(requestBody !== undefined ? { requestBody: requestBody.value } : {}),
		...(responseBody !== undefined ? { responseBody: responseBody.value } : {}),
		...(params.traceContext !== undefined ? { traceContext: params.traceContext } : {}),
	});
}

/** Hono全体へAccess log用のmiddlewareを登録します。 */
export function registerHttpAccessLog(app: Hono<ApiEnv>, manager: LogManager = logManager): void {
	if (!manager.isAccessLogEnabled()) return;

	// HTTP計装の後に登録し、リクエスト開始時のactiveなTrace Contextを保存します。
	app.use(async (ctx, next) => {
		const traceContext = manager.getActiveTraceContext();
		const startedAt = performance.now();
		const ownRouteIndex = ctx.req.routeIndex;

		try {
			await next();
		} catch (error) {
			// onErrorが処理しなかった例外もログへ残し、応答の生成はHono側へそのまま委ねます。
			await writeAccessLog(manager, ctx, {
				statusCode: 500,
				durationMs: performance.now() - startedAt,
				response: null,
				ownRouteIndex,
				errorType: getErrorType(error),
				traceContext,
			});
			throw error;
		}

		await writeAccessLog(manager, ctx, {
			statusCode: ctx.res.status,
			durationMs: performance.now() - startedAt,
			response: ctx.res,
			ownRouteIndex,
			// Honoはhandlerが投げた例外をonErrorで応答へ変換したとき、その例外をContextへ残します。
			...(ctx.error !== undefined ? { errorType: getErrorType(ctx.error) } : {}),
			traceContext,
		});
	});
}
