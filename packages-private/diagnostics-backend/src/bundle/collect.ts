/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import path from 'node:path';
import { collectVisualizerReport, type SizeEntry, type VisualizerReport } from 'diagnostics-shared/bundle';
import { fileSize, normalizePath, traverseDirectory } from 'diagnostics-shared/fs-utils';
import type { BackendBundleReport } from './types';

/**
 * rolldown の既定の `chunkFileNames` (`[name]-[hash].js`) に一致させる。
 * entry は `[name].js` で出力されハッシュを持たないので、ここにはマッチしない。
 */
const hashedChunkPattern = /^(?<name>.+)-[\w-]{8}\.js$/;

/**
 * 出力ファイル名からビルド間で安定する識別子を作る。
 * ハッシュ付きのチャンクはハッシュを除いた名前で対応付ける。
 * 同名のチャンクが複数できることがあるため (例: `ServerService-xxxxxxxx.js` が2つ)、
 * 呼び出し側で同じキーのものをまとめる前提。
 */
export function backendChunkIdentity(file: string) {
	const dir = path.posix.dirname(file);
	const prefix = dir === '.' ? '' : `${dir}/`;
	const name = hashedChunkPattern.exec(path.posix.basename(file))?.groups?.name;
	if (name == null) {
		return {
			comparisonKey: `entry:${file}`,
			displayName: file,
			filePattern: file,
		};
	}
	return {
		comparisonKey: `chunk:${prefix}${name}`,
		displayName: `${prefix}${name}`,
		filePattern: `${prefix}${name}-[hash].js`,
	};
}

/**
 * ビルド成果物 (`packages/backend/built`) の JS ファイルを、同じ識別子ごとに合算して返す。
 * サイズは minify 後のディスク上のサイズ。
 */
export async function collectBackendChunks(repoDir: string): Promise<SizeEntry[]> {
	const outDir = path.join(repoDir, 'packages/backend/built');
	const chunks = new Map<string, { displayName: string; filePattern: string; size: number; count: number }>();

	for await (const fullPath of traverseDirectory(outDir)) {
		if (!fullPath.endsWith('.js')) continue;
		const file = normalizePath(path.relative(outDir, fullPath));
		const { comparisonKey, displayName, filePattern } = backendChunkIdentity(file);
		const size = await fileSize(fullPath);
		const existing = chunks.get(comparisonKey);
		if (existing == null) {
			chunks.set(comparisonKey, { displayName, filePattern, size, count: 1 });
		} else {
			existing.size += size;
			existing.count += 1;
		}
	}

	if (chunks.size === 0) throw new Error(`No JavaScript output found in ${outDir}`);

	return [...chunks.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([comparisonKey, { displayName, filePattern, size, count }]) => ({
			comparisonKey,
			displayName,
			file: count === 1 ? filePattern : `${filePattern} ×${count}`,
			size,
		}));
}

/**
 * モジュールIDから、そのモジュールの属するパッケージ名を求める。
 * pnpm のレイアウト (`node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...`) を考慮し、最後の `node_modules/` 以降を見る。
 */
export function modulePackageName(id: string) {
	if (id.startsWith('\0')) return '(virtual)';

	const normalizedId = id.replaceAll('\\', '/');
	const nodeModulesIndex = normalizedId.lastIndexOf('/node_modules/');
	if (nodeModulesIndex >= 0) {
		const [first, second] = normalizedId.slice(nodeModulesIndex + '/node_modules/'.length).split('/');
		return first.startsWith('@') && second != null ? `${first}/${second}` : first;
	}

	const workspacePackage = /^\/?packages\/(?<name>[^/]+)\//.exec(normalizedId)?.groups?.name;
	if (workspacePackage != null) return `packages/${workspacePackage}`;

	return '(other)';
}

/**
 * rollup-plugin-visualizer の統計からパッケージ単位のサイズを集計する。
 * サイズは minify 前の (各モジュールがバンドルに出力された時点の) 長さ。
 */
export function collectPackageSizes(modules: ReturnType<typeof collectVisualizerReport>['hotModules']): SizeEntry[] {
	const packages = new Map<string, { size: number; modules: number }>();
	for (const module of modules) {
		const name = modulePackageName(module.id);
		const entry = packages.get(name) ?? { size: 0, modules: 0 };
		entry.size += module.renderedLength;
		entry.modules += 1;
		packages.set(name, entry);
	}

	return [...packages.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, { size, modules }]) => ({
			comparisonKey: name,
			displayName: name,
			file: `${modules} ${modules === 1 ? 'module' : 'modules'}`,
			size,
		}));
}

export async function collectBackendBundleReport(repoDir: string, stats: VisualizerReport | null): Promise<BackendBundleReport> {
	const chunks = await collectBackendChunks(repoDir);
	if (stats == null) return { chunks, visualizer: null };

	const { summary, metrics, hotModules } = collectVisualizerReport(stats);
	return {
		chunks,
		visualizer: {
			summary,
			metrics,
			packages: collectPackageSizes(hotModules),
		},
	};
}
