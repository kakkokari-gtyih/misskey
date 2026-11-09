/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	comparableMap,
	comparisonRowsAggregate,
	compareSizeComparisonRows,
	formatSizeChangeSummary,
	generatedAggregate,
	getSizeComparisonRows,
	hasSmallDelta,
	renderSizeDiffDetails,
	sizeMarkdownTable,
	sumSizes,
	summarizeSizeChanges,
} from 'diagnostics-shared/bundle';
import type { CollectedBundleReport } from './manifest';

export function renderFrontendChunkReport(base: CollectedBundleReport, head: CollectedBundleReport) {
	const baseStartupFiles = new Set(base.startupFiles);
	const headStartupFiles = new Set(head.startupFiles);
	const baseStartupChunks = base.chunks.filter(chunk => baseStartupFiles.has(chunk.file));
	const headStartupChunks = head.chunks.filter(chunk => headStartupFiles.has(chunk.file));
	const baseStartupComparable = comparableMap(baseStartupChunks);
	const headStartupComparable = comparableMap(headStartupChunks);
	const startupKeys = [...new Set([...Object.keys(baseStartupComparable), ...Object.keys(headStartupComparable)])];
	const startupComparisonRows = getSizeComparisonRows(startupKeys, baseStartupComparable, headStartupComparable);
	const startupSummary = summarizeSizeChanges(startupComparisonRows);
	const startupOther = comparisonRowsAggregate(startupComparisonRows.filter(hasSmallDelta));
	const startupRows = startupComparisonRows.filter(row => !hasSmallDelta(row)).sort(compareSizeComparisonRows);
	const startupTotal = {
		baseSize: sumSizes(baseStartupChunks),
		headSize: sumSizes(headStartupChunks),
	};
	const startupGenerated = generatedAggregate(baseStartupChunks, headStartupChunks);

	return [
		renderSizeDiffDetails(base.chunks, head.chunks, { title: 'Chunk size diff' }),
		'',
		'<details>',
		`<summary>${formatSizeChangeSummary('Startup chunk size', startupSummary)}</summary>`,
		'',
		sizeMarkdownTable(startupRows, startupTotal, startupGenerated, startupOther),
		'',
		'_Startup chunks are the Vite entry for \`src/_boot_.ts\` and its static imports._',
		'',
		'</details>',
		'',
	].join('\n');
}
