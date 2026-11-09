/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collectBackendBundleReport } from './bundle/collect';
import type { VisualizerReport } from 'diagnostics-shared/bundle';

async function readVisualizerStats(file: string) {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as VisualizerReport;
	} catch (err) {
		// visualizer 導入前のリビジョンをビルドした場合は統計ファイルが出ないので、ファイルサイズだけで比較する
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			console.warn(`Bundle visualizer stats not found: ${file}`);
			return null;
		}
		throw err;
	}
}

async function main() {
	const [repoDirArg, statsFileArg, outputFileArg] = process.argv.slice(2);
	if (repoDirArg == null || statsFileArg == null || outputFileArg == null) {
		throw new Error('Usage: inspect-bundle <repoDir> <bundleStats.json> <output.json>');
	}

	const stats = await readVisualizerStats(resolve(statsFileArg));
	const report = await collectBackendBundleReport(resolve(repoDirArg), stats);
	await writeFile(resolve(outputFileArg), JSON.stringify(report, null, '\t'));
}

await main().catch(err => {
	console.error(err);
	process.exit(1);
});
