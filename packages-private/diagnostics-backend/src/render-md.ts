/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readOptionalEnv, readRequiredEnv } from 'diagnostics-shared/env';
import { renderBundleReportMarkdown } from './bundle/markdown';
import { renderMemoryReportMarkdown } from './report/markdown';
import type { BackendBundleReport } from './bundle/types';
import type { MemoryReport } from './types';

async function readJson<T>(file: string) {
	return JSON.parse(await readFile(resolve(file), 'utf8')) as T;
}

async function main() {
	const [baseFileArg, headFileArg, baseBundleFileArg, headBundleFileArg, outputFileArg] = process.argv.slice(2);
	if (baseFileArg == null || headFileArg == null || baseBundleFileArg == null || headBundleFileArg == null || outputFileArg == null) {
		throw new Error('Usage: render-md <baseReport.json> <headReport.json> <baseBundle.json> <headBundle.json> <output.md>');
	}

	const [base, head, baseBundle, headBundle] = await Promise.all([
		readJson<MemoryReport>(baseFileArg),
		readJson<MemoryReport>(headFileArg),
		readJson<BackendBundleReport>(baseBundleFileArg),
		readJson<BackendBundleReport>(headBundleFileArg),
	]);

	const memoryMarkdown = renderMemoryReportMarkdown(base, head, {
		baseHeapSnapshotUrl: readRequiredEnv('MK_MEMORY_HEAP_SNAPSHOT_ARTIFACT_URL_BASE'),
		headHeapSnapshotUrl: readRequiredEnv('MK_MEMORY_HEAP_SNAPSHOT_ARTIFACT_URL_HEAD'),
	});
	const bundleMarkdown = renderBundleReportMarkdown(baseBundle, headBundle, {
		visualizerArtifactUrl: readOptionalEnv('MK_BUNDLE_VISUALIZER_ARTIFACT_URL'),
	});

	await writeFile(resolve(outputFileArg), `${memoryMarkdown}\n${bundleMarkdown}`);
}

await main().catch(err => {
	console.error(err);
	process.exit(1);
});
