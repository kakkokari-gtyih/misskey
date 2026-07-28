/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiCallService } from '@/server/api/ApiCallService.js';
import Logger from '@/logger.js';
import { envOption } from '@/env.js';
import { logManager } from '@/logging/logging-runtime.js';
import { PrettyConsoleBackend } from '@/logging/PrettyConsoleBackend.js';
import type { LogBackend } from '@/logging/LogBackend.js';
import type { LogRecord } from '@/logging/types.js';
import type { ApiEnv, ApiMultipartData } from '@/server/api/ApiServerTypes.js';
import type { IEndpoint } from '@/server/api/endpoints.js';

type TestEndpoint = IEndpoint & { exec: unknown };

const defaultQuiet = envOption.quiet;
const services: ApiCallService[] = [];

/** APIサービスの依存関係を最小限の仮実装へ差し替えます。 */
function createService() {
	const authenticateService = {
		authenticate: vi.fn().mockResolvedValue([null, null]),
	};
	const telemetryService = {
		startSpan: vi.fn((_name: string, callback: () => unknown) => callback()),
		captureMessage: vi.fn(),
	};
	const apiLoggerService = { logger: new Logger('api') };

	const service = new ApiCallService(
		{} as never,
		{} as never,
		{} as never,
		authenticateService as never,
		{} as never,
		{} as never,
		apiLoggerService as never,
		telemetryService as never,
	);
	services.push(service);
	return { service, telemetryService };
}

/** テスト対象のエンドポイントを、既定値付きで組み立てます。 */
function createEndpoint(exec: unknown, meta: Record<string, unknown> = {}): TestEndpoint {
	return { name: 'notes/show', meta, params: {}, exec } as unknown as TestEndpoint;
}

/**
 * ApiCallServiceをHonoのContext越しに呼び出す、最小のAPIサーバーを作成します。
 * requestとresponseはWeb標準のものがそのまま使われるため、偽のreply/requestは必要ありません。
 */
function createApp(service: ApiCallService, endpoint: TestEndpoint, multipartData?: ApiMultipartData): Hono<ApiEnv> {
	const app = new Hono<ApiEnv>();

	// ip / ips は本番ではServerServiceのmiddlewareが設定するため、テストでも同じように与えます。
	app.use(async (ctx, next) => {
		ctx.set('ip', '127.0.0.1');
		ctx.set('ips', ['127.0.0.1']);
		await next();
	});

	const path = `/api/${endpoint.name}`;
	app.get(path, ctx => service.handleRequest(endpoint as never, ctx));
	// ApiServerServiceと同じく、multipartかどうかで呼び分けます。
	app.post(path, async ctx => (ctx.req.header('content-type')?.startsWith('multipart/form-data')
		? service.handleMultipartRequest(endpoint as never, ctx, multipartData ?? null)
		: service.handleRequest(endpoint as never, ctx, await ctx.req.json())));

	return app;
}

/** JSONの本文を持つAPIリクエストを送ります。 */
async function postJson(app: Hono<ApiEnv>, endpoint: TestEndpoint, body: Record<string, unknown>): Promise<Response> {
	return app.request(`/api/${endpoint.name}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

afterEach(() => {
	for (const service of services.splice(0)) {
		service.dispose();
	}
	envOption.quiet = defaultQuiet;
	logManager.setBackend(new PrettyConsoleBackend({ output: () => undefined }));
});

describe('ApiCallService', () => {
	describe('handleRequest', () => {
		test('returns the endpoint result as JSON', async () => {
			const { service } = createService();
			const endpoint = createEndpoint(vi.fn().mockResolvedValue({ id: 'abc', text: 'hello' }));

			const res = await postJson(createApp(service, endpoint), endpoint, { noteId: 'abc' });

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toContain('application/json');
			expect(await res.json()).toEqual({ id: 'abc', text: 'hello' });
		});

		test('returns 204 when the endpoint has no result', async () => {
			const { service } = createService();
			const endpoint = createEndpoint(vi.fn().mockResolvedValue(undefined));

			const res = await postJson(createApp(service, endpoint), endpoint, {});

			expect(res.status).toBe(204);
			expect(await res.text()).toBe('');
		});

		test('caches anonymous GET responses when the endpoint allows it', async () => {
			const { service } = createService();
			const endpoint = createEndpoint(vi.fn().mockResolvedValue({ ok: true }), { cacheSec: 60 });

			const res = await createApp(service, endpoint).request(`/api/${endpoint.name}`);

			expect(res.status).toBe(200);
			expect(res.headers.get('cache-control')).toBe('public, max-age=60');
		});

		test('redacts API credentials and serializes the endpoint error', async () => {
			const write = vi.fn<LogBackend['write']>();
			logManager.setBackend({ write });
			envOption.quiet = false;
			const { service, telemetryService } = createService();
			const endpoint = createEndpoint(vi.fn().mockRejectedValue(new TypeError('broken endpoint')));

			const res = await postJson(createApp(service, endpoint), endpoint, {
				i: 'native-token',
				password: 'password',
				options: { visible: true },
			});

			expect(res.status).toBe(500);
			expect(await res.json()).toMatchObject({
				error: {
					code: 'INTERNAL_ERROR',
					kind: 'server',
					info: { e: { code: 'TypeError', message: 'broken endpoint' } },
				},
			});

			const record = write.mock.calls[0][0] as LogRecord;
			expect(record).toMatchObject({
				eventName: 'api.endpoint.failed',
				attributes: {
					'api.endpoint': 'notes/show',
					'api.params': {
						i: '[REDACTED]',
						password: '[REDACTED]',
						options: { visible: true },
					},
				},
				error: { type: 'TypeError', message: 'broken endpoint' },
			});
			expect(record.attributes?.['error.id']).toEqual(expect.any(String));
			expect(telemetryService.captureMessage.mock.calls[0][1].extra).not.toHaveProperty('ps');
		});
	});

	describe('handleMultipartRequest', () => {
		test('writes the uploaded body to a temporary file', async () => {
			const { service } = createService();
			const exec = vi.fn(async (_data: unknown, _user: unknown, _token: unknown, file: { name: string; path: string }) => ({
				name: file.name,
				content: await fs.promises.readFile(file.path, 'utf8'),
			}));
			const endpoint = createEndpoint(exec);
			const app = createApp(service, endpoint, {
				filename: 'note.txt',
				file: Readable.from([Buffer.from('uploaded body')]),
				truncated: false,
				fields: { comment: 'hi' },
			});

			const res = await app.request(`/api/${endpoint.name}`, {
				method: 'POST',
				headers: { 'content-type': 'multipart/form-data; boundary=----test' },
				body: '------test--\r\n',
			});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ name: 'note.txt', content: 'uploaded body' });
			expect(exec.mock.calls[0][0]).toEqual({ comment: 'hi' });
		});

		test('returns 400 when multipart data is missing', async () => {
			const { service } = createService();
			const exec = vi.fn();
			const endpoint = createEndpoint(exec);

			const res = await createApp(service, endpoint).request(`/api/${endpoint.name}`, {
				method: 'POST',
				headers: { 'content-type': 'multipart/form-data; boundary=----test' },
				body: '------test--\r\n',
			});

			expect(res.status).toBe(400);
			expect(exec).not.toHaveBeenCalled();
		});
	});
});
