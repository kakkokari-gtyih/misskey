/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test, beforeAll, afterAll, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import type { AiService } from '@/core/AiService.js';
import type { DownloadService } from '@/core/DownloadService.js';
import { FileInfoService } from '@/core/FileInfoService.js';
import { ImageProcessingService } from '@/core/ImageProcessingService.js';
import { InternalStorageService } from '@/core/InternalStorageService.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { VideoProcessingService } from '@/core/VideoProcessingService.js';
import { StatusError } from '@/misc/status-error.js';
import { loadConfig, type Config } from '@/config.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { miRepository, type DriveFilesRepository, type MiRepository } from '@/models/_.js';
import { FileServerService } from '@/server/FileServerService.js';
import { initTestDb, randomString } from '../../utils.js';
import type { Hono } from 'hono';

const CSP = 'default-src \'none\'; img-src \'self\'; media-src \'self\'; style-src \'unsafe-inline\'';

const dummyPath = path.resolve('test/resources/dummy-for-file-server-service.png');
const dummySize = fs.statSync(dummyPath).size;
const dummyBuffer = fs.readFileSync(dummyPath);
const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>', 'utf8');
const textBuffer = Buffer.from('dummy text', 'utf8');

// リモートのファイルはDownloadServiceの差し替えで再現するため、実在しないホストで構わない。
const remotePngUrl = 'https://remote.example.com/dummy.png';
const remoteSvgUrl = 'https://remote.example.com/dummy.svg';
const remoteTextUrl = 'https://remote.example.com/dummy.txt';
const remoteFlatPngUrl = 'https://remote.example.com/flat.png';

/** URLごとの固定データを保存先へ書き出すDownloadServiceを作成します。 */
function createDownloadServiceStub(files: ReadonlyMap<string, Buffer>): DownloadService {
	return {
		downloadUrl: async (url: string, destination: string) => {
			const body = files.get(url);
			if (body == null) throw new StatusError('404 Not Found', 404, 'Not Found');

			await fs.promises.writeFile(destination, body);

			// 本来のDownloadServiceと同じく、URLの末尾をファイル名として扱う。
			return { filename: new URL(url).pathname.split('/').pop() ?? 'untitled' };
		},
	} as unknown as DownloadService;
}

/** 応答本文を読み切り、ファイルのstreamを確実に閉じます。 */
async function readBody(response: Response): Promise<Buffer> {
	return Buffer.from(await response.arrayBuffer());
}

/** WebPへ変換された応答であることを、コンテナのマジックナンバーで確認します。 */
function expectWebp(body: Buffer): void {
	expect(body.subarray(0, 4).toString('ascii')).toBe('RIFF');
	expect(body.subarray(8, 12).toString('ascii')).toBe('WEBP');
}

describe('FileServerService', () => {
	let db: DataSource;
	let app: Hono;
	let externalApp: Hono;
	let driveFilesRepository: DriveFilesRepository;
	let internalStorageService: InternalStorageService;
	let idService: IdService;
	let config: Config;
	let rootDir: string;

	function writeInternalFile(key: string) {
		const dest = internalStorageService.resolvePath(key);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(dummyPath, dest);
	}

	async function insertDriveFile(params: {
		accessKey: string;
		thumbnailAccessKey?: string | null;
		webpublicAccessKey?: string | null;
		storedInternal: boolean;
		isLink: boolean;
		uri?: string | null;
		name?: string;
		type?: string;
		size?: number;
	}) {
		const accessKey = params.accessKey;
		const url = params.uri ?? `${config.url}/files/${accessKey}`;
		await driveFilesRepository.insert({
			id: idService.gen(),
			userId: null,
			userHost: null,
			md5: '00000000000000000000000000000000',
			name: params.name ?? 'dummy.png',
			type: params.type ?? 'image/png',
			size: params.size ?? dummySize,
			comment: null,
			blurhash: null,
			properties: {},
			storedInternal: params.storedInternal,
			url,
			thumbnailUrl: null,
			webpublicUrl: null,
			webpublicType: null,
			accessKey,
			thumbnailAccessKey: params.thumbnailAccessKey ?? null,
			webpublicAccessKey: params.webpublicAccessKey ?? null,
			uri: params.uri ?? null,
			src: null,
			folderId: null,
			isSensitive: false,
			maybeSensitive: false,
			maybePorn: false,
			isLink: params.isLink,
			requestHeaders: {},
			requestIp: null,
		});
	}

	beforeAll(async () => {
		db = await initTestDb(false);
		driveFilesRepository = db.getRepository(MiDriveFile).extend(miRepository as MiRepository<MiDriveFile>);

		// assets と内部ストレージはどちらも config.rootDir 起点で解決されるため、
		// rootDir ごと一時ディレクトリへ隔離してリポジトリを書き換えないようにする。
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misskey-file-server-service-'));
		const assetsDir = path.join(rootDir, 'packages/backend/src/server/file/assets');
		fs.mkdirSync(assetsDir, { recursive: true });
		fs.copyFileSync(dummyPath, path.join(assetsDir, 'dummy.png'));
		fs.copyFileSync(dummyPath, path.join(assetsDir, 'not-found.png'));

		config = { ...loadConfig(), rootDir };

		const flatPngBuffer = await sharp({
			create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
		}).png().toBuffer();
		const downloadService = createDownloadServiceStub(new Map([
			[remotePngUrl, dummyBuffer],
			[remoteSvgUrl, svgBuffer],
			[remoteTextUrl, textBuffer],
			[remoteFlatPngUrl, flatPngBuffer],
		]));

		const loggerService = new LoggerService();
		const aiService = {
			detectSensitive: async () => null,
			detectSensitiveMany: async (sources: Buffer[]) => sources.map(() => null),
		} as unknown as AiService;
		const fileInfoService = new FileInfoService(aiService, loggerService);
		const imageProcessingService = new ImageProcessingService();
		const videoProcessingService = new VideoProcessingService(config, imageProcessingService);
		internalStorageService = new InternalStorageService(config);
		idService = new IdService(config);

		const createFileServerService = (serviceConfig: Config) => new FileServerService(
			serviceConfig,
			driveFilesRepository,
			fileInfoService,
			downloadService,
			imageProcessingService,
			videoProcessingService,
			internalStorageService,
			loggerService,
		);

		app = createFileServerService(config).createServer();
		externalApp = createFileServerService({
			...config,
			mediaProxy: 'https://media-proxy.test',
			externalMediaProxyEnabled: true,
		}).createServer();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await driveFilesRepository.createQueryBuilder().delete().execute();
	});

	afterAll(async () => {
		await db.destroy();
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	describe('GET /files/app-default.jpg', () => {
		test('ヘッダを検証する', async () => {
			vi.stubEnv('NODE_ENV', 'test');

			const res = await app.request('/files/app-default.jpg');

			expect(res.status).toBe(200);
			expect(res.headers.get('content-security-policy')).toBe(CSP);
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-type')).toBe('image/jpeg');
			expect(res.headers.get('access-control-allow-origin')).toBeNull();
			expect(await readBody(res)).toEqual(dummyBuffer);
		});

		test('development で CORS を許可する', async () => {
			vi.stubEnv('NODE_ENV', 'development');

			const res = await app.request('/files/app-default.jpg');

			expect(res.status).toBe(200);
			expect(res.headers.get('access-control-allow-origin')).toBe('*');
			await readBody(res);
		});

		test('クエリを除去してリダイレクトする', async () => {
			const res = await app.request('/files/app-default.jpg?x=1');

			expect(res.status).toBe(301);
			expect(res.headers.get('location')).toBe('/files/app-default.jpg');
			expect(res.headers.get('content-security-policy')).toBe(CSP);
		});
	});

	describe('GET /files/:key', () => {
		test('404 のときダミー画像を返す', async () => {
			const res = await app.request(`/files/${randomString()}`);

			expect(res.status).toBe(404);
			expect(res.headers.get('cache-control')).toBe('public, max-age=0');
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(await readBody(res)).toEqual(dummyBuffer);
		});

		test('画像配信ヘッダを検証する', async () => {
			const accessKey = randomString();
			writeInternalFile(accessKey);
			await insertDriveFile({
				accessKey,
				storedInternal: true,
				isLink: false,
			});

			const res = await app.request(`/files/${accessKey}`);

			expect(res.status).toBe(200);
			expect(res.headers.get('content-security-policy')).toBe(CSP);
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('content-length')).toBe(String(dummySize));
			expect(res.headers.get('content-disposition') ?? '').toMatch(/^inline;/);
			expect(await readBody(res)).toEqual(dummyBuffer);
		});

		test('Range で部分配信する', async () => {
			const accessKey = randomString();
			writeInternalFile(accessKey);
			await insertDriveFile({
				accessKey,
				storedInternal: true,
				isLink: false,
			});

			const res = await app.request(`/files/${accessKey}`, { headers: { range: 'bytes=0-3' } });

			expect(res.status).toBe(206);
			expect(res.headers.get('content-range')).toBe(`bytes 0-3/${dummySize}`);
			expect(res.headers.get('accept-ranges')).toBe('bytes');
			expect(res.headers.get('content-length')).toBe('4');
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(await readBody(res)).toEqual(dummyBuffer.subarray(0, 4));
		});

		test('Range の終端を補正する', async () => {
			const accessKey = randomString();
			writeInternalFile(accessKey);
			await insertDriveFile({
				accessKey,
				storedInternal: true,
				isLink: false,
			});

			const res = await app.request(`/files/${accessKey}`, { headers: { range: 'bytes=0-999999' } });

			expect(res.status).toBe(206);
			expect(res.headers.get('content-range')).toBe(`bytes 0-${dummySize - 1}/${dummySize}`);
			expect(res.headers.get('accept-ranges')).toBe('bytes');
			expect(res.headers.get('content-length')).toBe(String(dummySize));
			expect(await readBody(res)).toEqual(dummyBuffer);
		});

		test('thumbnail の Range で部分配信する', async () => {
			const accessKey = randomString();
			const thumbnailKey = randomString();
			writeInternalFile(thumbnailKey);
			await insertDriveFile({
				accessKey,
				thumbnailAccessKey: thumbnailKey,
				storedInternal: true,
				isLink: false,
				name: 'sample.png',
			});

			const res = await app.request(`/files/${thumbnailKey}`, { headers: { range: 'bytes=0-3' } });

			expect(res.status).toBe(206);
			expect(res.headers.get('content-range')).toBe(`bytes 0-3/${dummySize}`);
			expect(res.headers.get('accept-ranges')).toBe('bytes');
			expect(res.headers.get('content-length')).toBe('4');
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(await readBody(res)).toEqual(dummyBuffer.subarray(0, 4));
		});

		test('thumbnail のファイル名を整形する', async () => {
			const accessKey = randomString();
			const thumbnailKey = randomString();
			writeInternalFile(thumbnailKey);
			await insertDriveFile({
				accessKey,
				thumbnailAccessKey: thumbnailKey,
				storedInternal: true,
				isLink: false,
				name: 'sample.png',
			});

			const res = await app.request(`/files/${thumbnailKey}`);

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-disposition') ?? '').toContain('sample-thumb.png');
			await readBody(res);
		});

		test('webpublic のファイル名を整形する', async () => {
			const accessKey = randomString();
			const webpublicKey = randomString();
			writeInternalFile(webpublicKey);
			await insertDriveFile({
				accessKey,
				webpublicAccessKey: webpublicKey,
				storedInternal: true,
				isLink: false,
				name: 'sample.png',
			});

			const res = await app.request(`/files/${webpublicKey}`);

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-disposition') ?? '').toContain('sample-web.png');
			await readBody(res);
		});

		test('browsersafe でない MIME は octet-stream になる', async () => {
			const accessKey = randomString();
			writeInternalFile(accessKey);
			await insertDriveFile({
				accessKey,
				storedInternal: true,
				isLink: false,
				type: 'application/x-msdownload',
			});

			const res = await app.request(`/files/${accessKey}`);

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('application/octet-stream');
			await readBody(res);
		});

		test('204 のときキャッシュ制御を返す', async () => {
			const accessKey = randomString();
			await insertDriveFile({
				accessKey,
				storedInternal: false,
				isLink: false,
			});

			const res = await app.request(`/files/${accessKey}`);

			expect(res.status).toBe(204);
			expect(res.headers.get('cache-control')).toBe('max-age=86400');
		});

		test('外部リンクを取得して配信する', async () => {
			const accessKey = randomString();
			await insertDriveFile({
				accessKey,
				storedInternal: false,
				isLink: true,
				uri: remotePngUrl,
				name: 'remote.png',
			});

			const res = await app.request(`/files/${accessKey}`);

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-length')).toBe(String(dummyBuffer.length));
			expect(res.headers.get('content-disposition') ?? '').toContain('remote.png');
			expect(await readBody(res)).toEqual(dummyBuffer);
		});

		test('外部リンクを Range で部分配信する', async () => {
			const accessKey = randomString();
			await insertDriveFile({
				accessKey,
				storedInternal: false,
				isLink: true,
				uri: remotePngUrl,
				name: 'remote.png',
			});

			const res = await app.request(`/files/${accessKey}`, { headers: { range: 'bytes=0-3' } });

			expect(res.status).toBe(206);
			expect(res.headers.get('content-range')).toBe(`bytes 0-3/${dummyBuffer.length}`);
			expect(res.headers.get('accept-ranges')).toBe('bytes');
			expect(res.headers.get('content-length')).toBe(String(dummyBuffer.length));
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(await readBody(res)).toEqual(dummyBuffer.subarray(0, 4));
		});

		test('thumbnail は mediaProxy/static.webp にリダイレクトする', async () => {
			const accessKey = randomString();
			const thumbnailKey = randomString();
			await insertDriveFile({
				accessKey,
				thumbnailAccessKey: thumbnailKey,
				storedInternal: false,
				isLink: true,
				uri: remotePngUrl,
				name: 'remote.png',
			});

			const res = await app.request(`/files/${thumbnailKey}`);

			expect(res.status).toBe(301);
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('location') ?? '').toContain(`${config.mediaProxy}/static.webp`);
			expect(res.headers.get('location') ?? '').toContain('static=1');
		});

		test('webpublic svg は mediaProxy/svg.webp にリダイレクトする', async () => {
			const accessKey = randomString();
			const webpublicKey = randomString();
			await insertDriveFile({
				accessKey,
				webpublicAccessKey: webpublicKey,
				storedInternal: false,
				isLink: true,
				uri: remoteSvgUrl,
				name: 'vector.svg',
				type: 'image/svg+xml',
			});

			const res = await app.request(`/files/${webpublicKey}`);

			expect(res.status).toBe(301);
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('location') ?? '').toContain(`${config.mediaProxy}/svg.webp`);
		});
	});

	describe('GET /files/:key/*', () => {
		test('正規の /files/:key にリダイレクトする', async () => {
			const res = await app.request('/files/testkey/extra/path');

			expect(res.status).toBe(301);
			expect(res.headers.get('location')).toBe(`${config.url}/files/testkey`);
			expect(res.headers.get('content-security-policy')).toBe(CSP);
		});
	});

	describe('GET /proxy/:url*', () => {
		test('外部メディアプロキシへリダイレクトする', async () => {
			const res = await externalApp.request('/proxy/path-part?url=https%3A%2F%2Fexample.com%2Fimg.png&static=1');

			expect(res.status).toBe(301);
			expect(res.headers.get('cache-control')).toBe('public, max-age=259200');
			expect(res.headers.get('location') ?? '').toContain('https://media-proxy.test/');
			expect(res.headers.get('location') ?? '').toContain('url=https%3A%2F%2Fexample.com%2Fimg.png');
			expect(res.headers.get('location') ?? '').toContain('static=1');
			expect(res.headers.get('content-security-policy')).toBe(CSP);
		});

		test('パス部分を外部メディアプロキシへ引き継ぐ', async () => {
			const res = await externalApp.request('/proxy/preview/img.webp?url=https%3A%2F%2Fexample.com%2Fimg.png');

			expect(res.status).toBe(301);
			expect(res.headers.get('location') ?? '').toContain('https://media-proxy.test/preview/img.webp');
		});

		test('misskey User-Agent を拒否する', async () => {
			const res = await app.request('/proxy/any?url=https%3A%2F%2Fexample.com%2Fimg.png', {
				headers: { 'user-agent': 'misskey/1.0' },
			});

			expect(res.status).toBe(403);
			expect(res.headers.get('cache-control')).toBe('max-age=300');
		});

		test('origin 指定時は User-Agent 必須を検証する', async () => {
			const res = await app.request('/proxy/any?url=https%3A%2F%2Fexample.com%2Fimg.png&origin=1', {
				headers: { 'user-agent': '' },
			});

			expect(res.status).toBe(400);
			expect(res.headers.get('cache-control')).toBe('max-age=300');
			expect(res.headers.get('location')).toBeNull();
			expect(res.headers.get('content-security-policy')).toBe(CSP);
		});

		test('emoji 指定で非画像は 404 を返す', async () => {
			const res = await app.request(`/proxy/any?url=${encodeURIComponent(remoteTextUrl)}&emoji=1`, {
				headers: { 'user-agent': 'Mozilla/5.0' },
			});

			expect(res.status).toBe(404);
			expect(res.headers.get('cache-control')).toBe('max-age=300');
		});

		test('非画像は 403 を返す', async () => {
			const res = await app.request(`/proxy/any?url=${encodeURIComponent(remoteTextUrl)}`, {
				headers: { 'user-agent': 'Mozilla/5.0' },
			});

			expect(res.status).toBe(403);
			expect(res.headers.get('cache-control')).toBe('max-age=300');
		});

		test('emoji static で webp を返す', async () => {
			const res = await app.request(`/proxy/any?url=${encodeURIComponent(remotePngUrl)}&emoji=1&static=1`, {
				headers: { 'user-agent': 'Mozilla/5.0' },
			});

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/webp');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-disposition') ?? '').toContain('dummy.png.webp');
			expectWebp(await readBody(res));
		});

		test('avatar static で webp を返す', async () => {
			const res = await app.request(`/proxy/any?url=${encodeURIComponent(remotePngUrl)}&avatar=1&static=1`, {
				headers: { 'user-agent': 'Mozilla/5.0' },
			});

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/webp');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-disposition') ?? '').toContain('dummy.png.webp');
			expectWebp(await readBody(res));
		});

		test('static で webp を返す', async () => {
			const res = await app.request(`/proxy/any?url=${encodeURIComponent(remotePngUrl)}&static=1`, {
				headers: { 'user-agent': 'Mozilla/5.0' },
			});

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/webp');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-disposition') ?? '').toContain('dummy.png.webp');
			expectWebp(await readBody(res));
		});

		test('preview で webp を返す', async () => {
			const res = await app.request(`/proxy/any?url=${encodeURIComponent(remotePngUrl)}&preview=1`, {
				headers: { 'user-agent': 'Mozilla/5.0' },
			});

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/webp');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-disposition') ?? '').toContain('dummy.png.webp');
			expectWebp(await readBody(res));
		});

		test('svg を webp に変換する', async () => {
			const res = await app.request(`/proxy/any?url=${encodeURIComponent(remoteSvgUrl)}`, {
				headers: { 'user-agent': 'Mozilla/5.0' },
			});

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/webp');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-disposition') ?? '').toContain('dummy.svg.webp');
			expectWebp(await readBody(res));
		});

		test('badge で低エントロピー画像は 404 を返す', async () => {
			const res = await app.request(`/proxy/any?url=${encodeURIComponent(remoteFlatPngUrl)}&badge=1`, {
				headers: { 'user-agent': 'Mozilla/5.0' },
			});

			expect(res.status).toBe(404);
			expect(res.headers.get('cache-control')).toBe('max-age=300');
		});

		test('画像をそのまま返す', async () => {
			const accessKey = randomString();
			writeInternalFile(accessKey);
			await insertDriveFile({
				accessKey,
				storedInternal: true,
				isLink: false,
			});

			const res = await app.request(`/proxy/any?url=${encodeURIComponent(`${config.url}/files/${accessKey}`)}&origin=1`, {
				headers: { 'user-agent': 'Mozilla/5.0' },
			});

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('cache-control')).toBe('max-age=31536000, immutable');
			expect(res.headers.get('content-disposition') ?? '').toContain('dummy.png');
			expect(await readBody(res)).toEqual(dummyBuffer);
		});
	});
});
