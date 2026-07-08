/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile, writeFile } from 'node:fs/promises';

type MemorySnapshot = {
	jsHeapUsedSize: number | null;
	jsHeapTotalSize: number | null;
};

type MemoryRecord = {
	test: {
		id: string;
		title: string;
		file: string;
		project: string;
		durationMs: number;
		status: string;
		retry: number;
	};
	timestamp: string;
	memory: {
		before: MemorySnapshot;
		after: MemorySnapshot;
		delta: MemorySnapshot;
	};
};

type MemoryReport = {
	generatedAt: string;
	reportPath: string;
	records: MemoryRecord[];
};

const [reportFileArg, outputFileArg] = process.argv.slice(2);

function formatMiB(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatMaybeMiB(bytes: number | null): string {
	if (bytes == null || !Number.isFinite(bytes)) return '-';
	return formatMiB(bytes);
}

function isNumber(value: number | null): value is number {
	return value != null && Number.isFinite(value);
}

function sortableValue(value: number | null): number {
	if (value == null || !Number.isFinite(value)) return Number.NEGATIVE_INFINITY;
	return value;
}

function summarize(records: MemoryRecord[]) {
	const count = records.length;
	const failed = records.filter(record => record.test.status !== 'passed').length;
	const heapUsedDeltas = records
		.map(record => record.memory.delta.jsHeapUsedSize)
		.filter(isNumber);
	const heapTotalDeltas = records
		.map(record => record.memory.delta.jsHeapTotalSize)
		.filter(isNumber);
	const totalDurationMs = records.reduce((sum, record) => sum + record.test.durationMs, 0);

	const maxHeapUsed = records
		.toSorted((a, b) => sortableValue(b.memory.after.jsHeapUsedSize) - sortableValue(a.memory.after.jsHeapUsedSize))
		.slice(0, 10);
	const maxHeapTotal = records
		.toSorted((a, b) => sortableValue(b.memory.after.jsHeapTotalSize) - sortableValue(a.memory.after.jsHeapTotalSize))
		.slice(0, 10);
	const largestHeapUsedDelta = records
		.toSorted((a, b) => sortableValue(b.memory.delta.jsHeapUsedSize) - sortableValue(a.memory.delta.jsHeapUsedSize))
		.slice(0, 10);

	const avgHeapUsedDelta = heapUsedDeltas.length > 0
		? heapUsedDeltas.reduce((sum, value) => sum + value, 0) / heapUsedDeltas.length
		: null;
	const avgHeapTotalDelta = heapTotalDeltas.length > 0
		? heapTotalDeltas.reduce((sum, value) => sum + value, 0) / heapTotalDeltas.length
		: null;

	return {
		count,
		failed,
		totalDurationMs,
		avgHeapUsedDelta,
		avgHeapTotalDelta,
		maxHeapUsed,
		maxHeapTotal,
		largestHeapUsedDelta,
	};
}

function renderRecordRows(records: MemoryRecord[], selector: (record: MemoryRecord) => number | null, valueLabel: 'heapUsed' | 'heapTotal' | 'deltaHeapUsed'): string[] {
	return records.map((record) => {
		const value = selector(record);
		const testName = record.test.title.replaceAll('|', '\\|');
		const status = record.test.status;
		if (valueLabel === 'deltaHeapUsed') {
			return `| ${testName} | ${formatMaybeMiB(record.memory.after.jsHeapUsedSize)} | ${formatMaybeMiB(value)} | ${status} |`;
		}
		return `| ${testName} | ${formatMaybeMiB(value)} | ${status} |`;
	});
}

function buildMarkdown(report: MemoryReport): string {
	const stats = summarize(report.records);
	const lines: string[] = [];

	lines.push('## Frontend E2E Memory Report');
	lines.push('');
	lines.push(`Generated: ${report.generatedAt}`);
	lines.push(`Tests: ${stats.count} (failed: ${stats.failed})`);
	lines.push(`Total measured test duration: ${(stats.totalDurationMs / 1000).toFixed(1)}s`);
	lines.push('Memory source: Chromium DevTools Protocol Performance.getMetrics');
	lines.push(`Average JSHeapUsedSize delta per test: ${formatMaybeMiB(stats.avgHeapUsedDelta)}`);
	lines.push(`Average JSHeapTotalSize delta per test: ${formatMaybeMiB(stats.avgHeapTotalDelta)}`);
	lines.push('');

	lines.push('### Top JSHeapUsedSize after test');
	lines.push('');
	lines.push('| Test | JSHeapUsedSize after | Status |');
	lines.push('| --- | ---: | --- |');
	lines.push(...renderRecordRows(stats.maxHeapUsed, (record) => record.memory.after.jsHeapUsedSize, 'heapUsed'));
	lines.push('');

	lines.push('### Top JSHeapTotalSize after test');
	lines.push('');
	lines.push('| Test | JSHeapTotalSize after | Status |');
	lines.push('| --- | ---: | --- |');
	lines.push(...renderRecordRows(stats.maxHeapTotal, (record) => record.memory.after.jsHeapTotalSize, 'heapTotal'));
	lines.push('');

	lines.push('### Largest JSHeapUsedSize increases');
	lines.push('');
	lines.push('| Test | JSHeapUsedSize after | JSHeapUsedSize delta | Status |');
	lines.push('| --- | ---: | ---: | --- |');
	lines.push(...renderRecordRows(stats.largestHeapUsedDelta, (record) => record.memory.delta.jsHeapUsedSize, 'deltaHeapUsed'));
	lines.push('');

	return lines.join('\n');
}

async function main() {
	if (reportFileArg == null || outputFileArg == null) {
		throw new Error('Usage: node .github/scripts/frontend-memory-report.mts <memory-report.json> <output.md>');
	}

	const reportJson = await readFile(reportFileArg, 'utf8');
	const report = JSON.parse(reportJson) as MemoryReport;
	if (!Array.isArray(report.records)) {
		throw new Error('Invalid report format: records is not an array');
	}

	const markdown = buildMarkdown(report);
	await writeFile(outputFileArg, `${markdown}\n`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
