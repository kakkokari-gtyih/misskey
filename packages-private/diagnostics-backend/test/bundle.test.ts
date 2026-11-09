/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
	backendChunkIdentity,
	collectBackendBundleReport,
	collectBackendChunks,
	modulePackageName,
} from '../src/bundle/collect';
import { renderBundleReportMarkdown } from '../src/bundle/markdown';
import type { VisualizerReport } from 'diagnostics-shared/bundle';
import type { BackendBundleReport } from '../src/bundle/types';

/**
 * ビルド成果物のfixture。
 *
 * `collectBackendChunks` はファイルの中身を見ずサイズしか使わないので、実体は指定バイト数の
 * 詰め物でよい。ディレクトリ名が `built` になるためリポジトリにはコミットできず
 * (ルートの .gitignore がビルド成果物として除外する)、テスト実行時に組み立てている。
 */
const fileSizes = {
	base: {
		'entry.js': 1_000,
		'gen-spec.js': 300,
		'ServerService-AAAAAAAA.js': 50_000,
		'ServerService--BBBBBBB.js': 2_000,
		'lib-CCCCCCCC.js': 10_000,
		'api.json': 99_999,
	},
	head: {
		'entry.js': 1_000,
		'gen-spec.js': 300,
		// ハッシュが変わっても同じチャンクとして対応付けられる
		'ServerService-DDDDDDDD.js': 60_000,
		'ServerService-EEEEEEEE.js': 2_000,
		'lib-FFFFFFFF.js': 10_000,
		'undici-GGGGGGGG.js': 40_000,
		'api.json': 99_999,
	},
} as const satisfies Record<'base' | 'head', Record<string, number>>;

let repoDirs: { base: string; head: string };
let workDir: string;

beforeAll(async () => {
	workDir = await mkdtemp(join(tmpdir(), 'diagnostics-backend-bundle-test-'));

	for (const label of ['base', 'head'] as const) {
		const outDir = join(workDir, label, 'packages/backend/built');
		for (const [file, size] of Object.entries(fileSizes[label])) {
			const path = join(outDir, file);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, 'x'.repeat(size));
		}
	}

	repoDirs = {
		base: join(workDir, 'base'),
		head: join(workDir, 'head'),
	};
});

afterAll(async () => {
	await rm(workDir, { recursive: true, force: true });
});

function visualizerStats(modules: Record<string, number>): VisualizerReport {
	const nodeParts: NonNullable<VisualizerReport['nodeParts']> = {};
	const nodeMetas: NonNullable<VisualizerReport['nodeMetas']> = {};
	for (const [index, [id, renderedLength]] of Object.entries(modules).entries()) {
		nodeParts[`part-${index}`] = { renderedLength, gzipLength: 0, brotliLength: 0 };
		nodeMetas[`meta-${index}`] = {
			id,
			moduleParts: { 'entry.js': `part-${index}` },
			renderedLength,
			gzipLength: 0,
			brotliLength: 0,
		};
	}
	return { nodeParts, nodeMetas };
}

test('identifies entries by file name and hashed chunks by their name', () => {
	expect(backendChunkIdentity('entry.js').comparisonKey).toBe('entry:entry.js');
	expect(backendChunkIdentity('gen-spec.js').comparisonKey).toBe('entry:gen-spec.js');
	expect(backendChunkIdentity('gen-spec-CAHLkspH.js').comparisonKey).toBe('chunk:gen-spec');
	expect(backendChunkIdentity('ChartManagementService--9s2gp-Z.js').comparisonKey).toBe('chunk:ChartManagementService');
});

test('resolves the package of a module id', () => {
	expect(modulePackageName('/node_modules/.pnpm/typeorm@0.3.0/node_modules/typeorm/index.js')).toBe('typeorm');
	expect(modulePackageName('/node_modules/.pnpm/@nestjs+core@11.0.0/node_modules/@nestjs/core/index.js')).toBe('@nestjs/core');
	expect(modulePackageName('/packages/backend/src/boot/entry.ts')).toBe('packages/backend');
	expect(modulePackageName('\0rolldown/runtime.js')).toBe('(virtual)');
	expect(modulePackageName('node:fs')).toBe('(other)');
});

test('sums JavaScript chunks that share a name', async () => {
	const chunks = await collectBackendChunks(repoDirs.base);

	expect(chunks).toContainEqual({
		comparisonKey: 'chunk:ServerService',
		displayName: 'ServerService',
		file: 'ServerService-[hash].js ×2',
		size: 52_000,
	});
	expect(chunks.some(chunk => chunk.file.endsWith('.json'))).toBe(false);
});

test('fails loudly when the built output is missing', async () => {
	await expect(collectBackendChunks(join(workDir, 'nonexistent'))).rejects.toThrow();
});

test('renders chunk and package diffs', async () => {
	const base = await collectBackendBundleReport(repoDirs.base, visualizerStats({
		'/packages/backend/src/boot/entry.ts': 5_000,
		'/node_modules/.pnpm/typeorm@0.3.0/node_modules/typeorm/index.js': 100_000,
	}));
	const head = await collectBackendBundleReport(repoDirs.head, visualizerStats({
		'/packages/backend/src/boot/entry.ts': 5_000,
		'/node_modules/.pnpm/typeorm@0.3.0/node_modules/typeorm/index.js': 120_000,
		'/node_modules/.pnpm/undici@7.0.0/node_modules/undici/index.js': 80_000,
	}));

	const markdown = renderBundleReportMarkdown(base, head, { visualizerArtifactUrl: 'https://example.invalid/treemap' });

	expect(markdown).toContain('<summary>Chunk size diff (1 updated, 1 added, 0 removed)</summary>');
	expect(markdown).toContain('<summary>`ServerService`</summary> `ServerService-[hash].js ×2`');
	expect(markdown).toContain('<summary>`undici`</summary> `undici-[hash].js`');
	expect(markdown).toContain('<summary>Package size diff (1 updated, 1 added, 0 removed)</summary>');
	expect(markdown).toContain('| Package | Base | Head | Δ | Δ\u00A0(%) |');
	expect(markdown).toContain('<summary>`typeorm`</summary> `1 module`');
	expect(markdown).toContain('<th rowspan="2">Rendered size</th>');
	expect(markdown).not.toContain('Gzip');
	expect(markdown).toContain('[Open treemap HTML](https://example.invalid/treemap)');
});

test('falls back to the file size diff when visualizer stats are missing on one side', async () => {
	const base: BackendBundleReport = await collectBackendBundleReport(repoDirs.base, null);
	const head = await collectBackendBundleReport(repoDirs.head, visualizerStats({
		'/packages/backend/src/boot/entry.ts': 5_000,
	}));

	const markdown = renderBundleReportMarkdown(base, head, { visualizerArtifactUrl: null });

	expect(markdown).toContain('<summary>Chunk size diff');
	expect(markdown).not.toContain('Package size diff');
	expect(markdown).toContain('_Bundle visualizer stats are not available for base._');
	expect(markdown).not.toContain('Open treemap HTML');
});
