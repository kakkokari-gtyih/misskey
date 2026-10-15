/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * locales/ja-JP.yml のキーのうち、packages/ 配下のソースコードから参照されていないものを列挙する。
 *
 * Usage: pnpm --filter i18n-unused-checker check [--root <repo root>] [--base <base repo root>]
 *   --root: 検査対象のリポジトリ (省略時はこのパッケージを含むリポジトリ)
 *   --base: 指定すると、base では未使用でなかった (= 新たに未使用になった) キーがある場合のみ失敗する
 *
 * 未使用のキー (--base 指定時は新たに未使用になったキー) が 1 件以上あれば exit code 1 で終了する。
 * パスは呼び出し側のカレントディレクトリ基準で解決する。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { findUnusedKeys, LOCALE_FILE } from './find-unused.js';

const IGNORE_HINT = '誤検出の場合は packages-private/i18n-unused-checker/src/find-unused.ts の IGNORED_KEYS に追加してください。';

function writeStepSummary(lines: string[]): void {
	const file = process.env.GITHUB_STEP_SUMMARY;
	if (file) fs.appendFileSync(file, lines.join('\n') + '\n');
}

function details(summary: string, keys: string[]): string[] {
	return ['<details>', `<summary>${summary}</summary>`, '', ...keys.map(k => `- \`${k}\``), '', '</details>', ''];
}

function main(): number {
	const { values } = parseArgs({
		options: {
			root: { type: 'string', default: path.resolve(import.meta.dirname, '../../..') },
			base: { type: 'string' },
		},
	});

	const unused = findUnusedKeys(path.resolve(values.root));

	if (values.base == null) {
		if (unused.length === 0) {
			console.log(`No unused keys in ${LOCALE_FILE}.`);
			return 0;
		}
		console.log(`Found ${unused.length} unused key(s) in ${LOCALE_FILE}:`);
		for (const key of unused) console.log(`  ${key}`);
		console.log(`\n${IGNORE_HINT}`);
		return 1;
	}

	const baseUnused = new Set(findUnusedKeys(path.resolve(values.base)));
	const introduced = unused.filter(key => !baseUnused.has(key));
	const resolved = [...baseUnused].filter(key => !unused.includes(key));

	console.log(`${LOCALE_FILE}: ${unused.length} unused key(s) (base: ${baseUnused.size}).`);
	if (resolved.length > 0) console.log(`${resolved.length} key(s) are no longer unused.`);

	const summary = ['## Unused i18n keys', ''];
	if (introduced.length > 0) {
		summary.push(`:x: このPRで新たに未使用になったキーが ${introduced.length} 件あります。削除するか、参照するコードを追加してください。`, '');
		summary.push(...introduced.map(k => `- \`${k}\``), '', IGNORE_HINT, '');
	} else {
		summary.push(':white_check_mark: このPRで新たに未使用になったキーはありません。', '');
	}
	summary.push(...details(`既存の未使用キー (${unused.length - introduced.length} 件)`, unused.filter(k => baseUnused.has(k))));
	writeStepSummary(summary);

	if (introduced.length === 0) {
		console.log('No newly unused keys.');
		return 0;
	}

	console.log(`Found ${introduced.length} newly unused key(s):`);
	for (const key of introduced) console.log(`  ${key}`);
	console.log(`\n${IGNORE_HINT}`);
	return 1;
}

process.exitCode = main();
