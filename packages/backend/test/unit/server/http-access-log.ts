/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';
import { LogManager } from '@/logging/LogManager.js';
import type { AccessLogRecord, AccessLogStatusClass } from '@/logging/types.js';
import type { ApiEnv } from '@/server/api/ApiServerTypes.js';
import { registerHttpAccessLog } from '@/server/http-access-log.js';

type TestServer = {
	readonly app: Hono<ApiEnv>;
	readonly manager: LogManager;
	readonly writeAccess: ReturnType<typeof vi.fn>;
};

type TestManager = {
	readonly manager: LogManager;
	readonly writeAccess: ReturnType<typeof vi.fn>;
};

/** Access logの動作確認用に固定時刻・プロセス情報を持つManagerを作成します。 */
function createManager(options: {
	statusClasses?: AccessLogStatusClass[];
	requestBody?: boolean;
	responseBody?: boolean;
	maxBytes?: number;
	nodeEnv?: string;
	quiet?: boolean;
} = {}): TestManager {
	const writeAccess = vi.fn<(record: AccessLogRecord) => void>();
	const manager = new LogManager({ write: vi.fn(), writeAccess }, {
		now: () => new Date('2026-07-22T00:00:00.000Z'),
		getProcessInfo: () => ({ processId: 123, isPrimary: true, workerId: null }),
		isQuiet: () => options.quiet ?? false,
		isVerbose: () => false,
		getNodeEnv: () => options.nodeEnv ?? 'development',
	});
	manager.configure({
		access: {
			statusClasses: options.statusClasses ?? ['2xx', '3xx', '4xx', '5xx'],
			bodies: {
				request: options.requestBody ?? false,
				response: options.responseBody ?? false,
				maxBytes: options.maxBytes,
			},
		},
	});
	return { manager, writeAccess };
}

/** Access log middlewareを登録したテスト用Honoを作成します。 */
function createServer(options: Parameters<typeof createManager>[0] = {}): TestServer {
	const { manager, writeAccess } = createManager(options);
	const app = new Hono<ApiEnv>();
	registerHttpAccessLog(app, manager);
	// 既定のerror handlerはstack traceを出力するため、テストでは静かなhandlerへ差し替えます。
	app.onError((_error, ctx) => ctx.text('failed', 500));
	app.get('/items/:id', ctx => ctx.json({ ok: true }));
	app.get('/bad', ctx => ctx.json({ error: 'bad' }, 400));
	app.get('/fail', () => {
		throw new TypeError('failure');
	});
	app.get('/redirect', ctx => ctx.redirect('/items/redirect'));
	app.post('/body', async ctx => ctx.json({ echo: await ctx.req.json(), token: 'response-secret' }));
	app.get('/text', ctx => ctx.text('response text'));
	app.get('/form', ctx => ctx.body('i=form-token&password=form-password&visible=yes', 200, { 'content-type': 'application/x-www-form-urlencoded' }));
	app.get('/binary', () => new Response(new TextEncoder().encode('binary'), { headers: { 'content-type': 'application/octet-stream' } }));
	app.get('/stream', ctx => ctx.body(new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('stream body'));
			controller.close();
		},
	}), 200, { 'content-type': 'text/plain' }));
	return { app, manager, writeAccess };
}

describe('registerHttpAccessLog', () => {
	test('filters responses by configured status classes and keeps the route template', async () => {
		const server = createServer({ statusClasses: ['4xx', '5xx'] });

		await server.app.request('/items/secret?id=hidden');
		await server.app.request('/bad');
		await server.app.request('/fail');
		await server.app.request('/missing?token=hidden');

		expect(server.writeAccess).toHaveBeenCalledTimes(3);
		expect(server.writeAccess.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
			expect.objectContaining({ route: '/bad', statusCode: 400 }),
			expect.objectContaining({ route: '/fail', statusCode: 500, errorType: 'TypeError' }),
			expect.objectContaining({ route: null, statusCode: 404 }),
		]));
		expect(server.writeAccess.mock.calls[0][0]).not.toHaveProperty('requestUrl');
		expect(server.writeAccess.mock.calls.find(call => call[0].statusCode === 404)?.[0]).not.toHaveProperty('errorType');
	});

	test('records redirects and reports an empty body as zero bytes', async () => {
		const server = createServer({ statusClasses: ['3xx'] });

		await server.app.request('/redirect');

		expect(server.writeAccess).toHaveBeenCalledWith(expect.objectContaining({
			method: 'GET',
			route: '/redirect',
			statusCode: 302,
			responseSizeBytes: 0,
		}));
	});

	test('captures and redacts JSON request and response bodies in development', async () => {
		const server = createServer({ requestBody: true, responseBody: true });

		await server.app.request('/body', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ i: 'request-token', nested: { password: 'request-password' }, value: 'visible' }),
		});

		expect(server.writeAccess).toHaveBeenCalledWith(expect.objectContaining({
			requestBody: {
				i: '[REDACTED]',
				nested: { password: '[REDACTED]' },
				value: 'visible',
			},
			responseBody: {
				echo: {
					i: '[REDACTED]',
					nested: { password: '[REDACTED]' },
					value: 'visible',
				},
				token: '[REDACTED]',
			},
		}));
	});

	test('captures text but omits binary bodies', async () => {
		const server = createServer({ statusClasses: ['2xx'], responseBody: true });

		await server.app.request('/text');
		await server.app.request('/binary');

		expect(server.writeAccess.mock.calls[0][0]).toHaveProperty('responseBody', 'response text');
		expect(server.writeAccess.mock.calls[1][0]).not.toHaveProperty('responseBody');
	});

	test('parses form bodies before redaction', async () => {
		const server = createServer({ statusClasses: ['2xx'], responseBody: true });

		await server.app.request('/form');

		expect(server.writeAccess).toHaveBeenCalledWith(expect.objectContaining({
			responseBody: {
				i: '[REDACTED]',
				password: '[REDACTED]',
				visible: 'yes',
			},
		}));
	});

	test('truncates normalized bodies to the configured limit', async () => {
		const server = createServer({ requestBody: true, responseBody: true, maxBytes: 1024 });

		await server.app.request('/body', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ value: 'x'.repeat(20_000) }),
		});

		const record = server.writeAccess.mock.calls[0][0];
		expect(Buffer.byteLength(JSON.stringify(record.requestBody), 'utf8')).toBeLessThanOrEqual(1024);
		expect(Buffer.byteLength(JSON.stringify(record.responseBody), 'utf8')).toBeLessThanOrEqual(1024);
	});

	test('preserves the response payload while capturing a streamed body', async () => {
		const server = createServer({ statusClasses: ['2xx'], responseBody: true });

		const response = await server.app.request('/stream');

		expect(await response.text()).toBe('stream body');
		expect(server.writeAccess).toHaveBeenCalledWith(expect.objectContaining({
			responseBody: 'stream body',
			responseSizeBytes: 11,
		}));
	});

	test('reports an unknown response size when the body is not read', async () => {
		const server = createServer({ statusClasses: ['2xx'] });

		await server.app.request('/text');

		expect(server.writeAccess).toHaveBeenCalledWith(expect.objectContaining({ responseSizeBytes: null }));
	});

	test('does not capture bodies in production and returns a warning', async () => {
		const { manager, writeAccess } = createManager({ nodeEnv: 'production', requestBody: true, responseBody: true });
		const warnings = manager.configure({ access: { statusClasses: ['2xx'], bodies: { request: true, response: true } } });
		const app = new Hono<ApiEnv>();
		registerHttpAccessLog(app, manager);
		app.post('/body', async ctx => ctx.json({ body: await ctx.req.json() }));

		await app.request('/body', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token: 'hidden' }),
		});

		expect(warnings).toEqual(['logging.access.bodies is disabled in production mode']);
		expect(writeAccess).toHaveBeenCalledWith(expect.not.objectContaining({ requestBody: expect.anything(), responseBody: expect.anything() }));
	});

	test('keeps the request Trace Context through response completion', async () => {
		const server = createServer({ statusClasses: ['2xx'] });
		const traceContext = { traceId: 'trace', spanId: 'span', traceFlags: 1 };
		const provider = vi.fn(() => traceContext);
		server.manager.setTraceContextProvider(provider);

		await server.app.request('/items/trace');

		expect(provider).toHaveBeenCalledOnce();
		expect(server.writeAccess).toHaveBeenCalledWith(expect.objectContaining(traceContext));
	});

	test('omits a Trace Context that was not active at request start', async () => {
		const server = createServer({ statusClasses: ['2xx'] });
		const provider = vi.fn()
			.mockReturnValueOnce(undefined)
			.mockReturnValue({ traceId: 'late-trace', spanId: 'late-span', traceFlags: 1 });
		server.manager.setTraceContextProvider(provider);

		await server.app.request('/items/no-trace');

		expect(server.writeAccess.mock.calls[0][0]).not.toHaveProperty('traceId');
		expect(provider).toHaveBeenCalledOnce();
	});

	test('does not write in quiet mode', async () => {
		const server = createServer({ quiet: true });
		const provider = vi.fn(() => ({ traceId: 'trace', spanId: 'span', traceFlags: 1 }));
		server.manager.setTraceContextProvider(provider);

		await server.app.request('/items/quiet');

		expect(provider).not.toHaveBeenCalled();
		expect(server.writeAccess).not.toHaveBeenCalled();
	});
});
