/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { listUnusedLeaves, parseLocaleTree } from './locale-tree.js';
import { extractChains, extractKeyPathLiterals } from './scanner.js';
import { isIgnored, markChain, markKeyPath } from './checker.js';

export const LOCALE_FILE = 'locales/ja-JP.yml';

/** 走査しないパッケージ (ロケールの定義元・i18n を使わないもの) */
const EXCLUDED_PACKAGES = new Set(['i18n', 'misskey-js']);

const EXCLUDED_DIRS = new Set([
	'node_modules',
	'built',
	'built-test',
	'dist',
	'coverage',
	'storybook-static',
	'autogen',
	'test',
	'__tests__',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.vue']);

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * 未使用扱いから除外するキー。`foo.bar` は完全一致、`foo.*` は配下すべてにマッチする。
 * ソースコードから参照されないが意図的に残しているキーがあればここに追加する。
 */
const IGNORED_KEYS: readonly string[] = [];

function* listSourceFiles(dir: string): Generator<string> {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
			yield* listSourceFiles(full);
		} else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !TEST_FILE.test(entry.name)) {
			yield full;
		}
	}
}

/** リポジトリ `repoRoot` の `locales/ja-JP.yml` のうち、`packages/` 配下から参照されていないキーを返す */
export function findUnusedKeys(repoRoot: string): string[] {
	const tree = parseLocaleTree(fs.readFileSync(path.join(repoRoot, LOCALE_FILE), 'utf-8'));

	const packagesDir = path.join(repoRoot, 'packages');
	for (const pkg of fs.readdirSync(packagesDir, { withFileTypes: true })) {
		if (!pkg.isDirectory() || EXCLUDED_PACKAGES.has(pkg.name)) continue;
		for (const file of listSourceFiles(path.join(packagesDir, pkg.name))) {
			const src = fs.readFileSync(file, 'utf-8');
			for (const chain of extractChains(src)) markChain(tree, chain);
			for (const segments of extractKeyPathLiterals(src)) markKeyPath(tree, segments);
		}
	}

	return listUnusedLeaves(tree).filter(key => !isIgnored(key, IGNORED_KEYS));
}
