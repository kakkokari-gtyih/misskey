/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * locales/ja-JP.yml のキーのうち、packages/ 配下のソースコードから参照されていないものを列挙する。
 *
 * Usage: pnpm --filter i18n-unused-checker check [--root <repo root>] [--base <base repo root>] [--fix]
 *   --root: 検査対象のリポジトリ (省略時はこのパッケージを含むリポジトリ)
 *   --base: 指定すると、base では未使用でなかった (= 新たに未使用になった) キーだけを対象にする
 *   --fix:  対象のキーを --root の locales/ja-JP.yml から削除する
 *
 * 対象のキーが 1 件以上あれば exit code 1 で終了する (--fix 指定時は削除して 0 で終了する)。
 * パスは呼び出し側のカレントディレクトリ基準で解決する。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { findUnusedKeys, LOCALE_FILE } from './find-unused.js';
import { removeKeys } from './remove-keys.js';

const IGNORE_HINT = '誤検出の場合は packages-private/i18n-unused-checker/src/find-unused.ts の IGNORED_KEYS に追加してください。';

function writeStepSummary(lines: string[]): void {
	const file = process.env.GITHUB_STEP_SUMMARY;
	if (file) fs.appendFileSync(file, lines.join('\n') + '\n');
}

function details(summary: string, keys: string[]): string[] {
	return ['<details>', `<summary>${summary}</summary>`, '', ...keys.map(k => `- \`${k}\``), '', '</details>', ''];
}

function fix(root: string, keys: string[]): void {
	const file = path.join(root, LOCALE_FILE);
	fs.writeFileSync(file, removeKeys(fs.readFileSync(file, 'utf-8'), keys));
	console.log(`Removed ${keys.length} key(s) from ${LOCALE_FILE}:`);
	for (const key of keys) console.log(`  ${key}`);
	console.log('\npackages/i18n/src/autogen/locale.ts を更新するため `pnpm --filter i18n generate` を実行してください。');
}

function main(): number {
	const { values } = parseArgs({
		options: {
			root: { type: 'string', default: path.resolve(import.meta.dirname, '../../..') },
			base: { type: 'string' },
			fix: { type: 'boolean', default: false },
		},
	});
	const root = path.resolve(values.root);

	const unused = findUnusedKeys(root);
	let targets = unused;

	if (values.base != null) {
		const baseUnused = new Set(findUnusedKeys(path.resolve(values.base)));
		targets = unused.filter(key => !baseUnused.has(key));
		const resolved = [...baseUnused].filter(key => !unused.includes(key));

		console.log(`${LOCALE_FILE}: ${unused.length} unused key(s) (base: ${baseUnused.size}).`);
		if (resolved.length > 0) console.log(`${resolved.length} key(s) are no longer unused.`);

		const summary = ['## Unused i18n keys', ''];
		if (targets.length > 0) {
			summary.push(`:x: このPRで新たに未使用になったキーが ${targets.length} 件あります。削除するか、参照するコードを追加してください。`, '');
			summary.push(...targets.map(k => `- \`${k}\``), '', IGNORE_HINT, '');
		} else {
			summary.push(':white_check_mark: このPRで新たに未使用になったキーはありません。', '');
		}
		summary.push(...details(`既存の未使用キー (${unused.length - targets.length} 件)`, unused.filter(k => baseUnused.has(k))));
		writeStepSummary(summary);
	}

	const label = values.base != null ? 'newly unused' : 'unused';
	if (targets.length === 0) {
		console.log(`No ${label} keys in ${LOCALE_FILE}.`);
		return 0;
	}

	if (values.fix) {
		fix(root, targets);
		return 0;
	}

	console.log(`Found ${targets.length} ${label} key(s) in ${LOCALE_FILE}:`);
	for (const key of targets) console.log(`  ${key}`);
	console.log(`\n--fix を付けて実行すると削除できます。${IGNORE_HINT}`);
	return 1;
}

process.exitCode = main();
