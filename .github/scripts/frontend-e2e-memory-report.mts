/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile, writeFile } from 'node:fs/promises';

type MemorySnapshot = {
	rss: number;
	heapTotal: number;
	heapUsed: number;
	external: number;
	arrayBuffers: number;
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

function summarize(records: MemoryRecord[]) {
	const count = records.length;
	const failed = records.filter(record => record.test.status !== 'passed').length;
	const rssDeltas = records.map(record => record.memory.delta.rss);
	const heapDeltas = records.map(record => record.memory.delta.heapUsed);
	const totalDurationMs = records.reduce((sum, record) => sum + record.test.durationMs, 0);

	const maxRss = records
		.toSorted((a, b) => b.memory.after.rss - a.memory.after.rss)
		.slice(0, 10);
	const maxHeapUsed = records
		.toSorted((a, b) => b.memory.after.heapUsed - a.memory.after.heapUsed)
		.slice(0, 10);
	const largestRssDelta = records
		.toSorted((a, b) => b.memory.delta.rss - a.memory.delta.rss)
		.slice(0, 10);

	const avgRssDelta = count > 0 ? rssDeltas.reduce((sum, value) => sum + value, 0) / count : 0;
	const avgHeapDelta = count > 0 ? heapDeltas.reduce((sum, value) => sum + value, 0) / count : 0;

	return {
		count,
		failed,
		totalDurationMs,
		avgRssDelta,
		avgHeapDelta,
		maxRss,
		maxHeapUsed,
		largestRssDelta,
	};
}

function renderRecordRows(records: MemoryRecord[], selector: (record: MemoryRecord) => number, valueLabel: 'rss' | 'heapUsed' | 'deltaRss'): string[] {
	return records.map((record) => {
		const value = selector(record);
		const testName = record.test.title.replaceAll('|', '\\|');
		const status = record.test.status;
		if (valueLabel === 'deltaRss') {
			return `| ${testName} | ${formatMiB(record.memory.after.rss)} | ${formatMiB(value)} | ${status} |`;
		}
		return `| ${testName} | ${formatMiB(value)} | ${status} |`;
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
	lines.push(`Average RSS delta per test: ${formatMiB(stats.avgRssDelta)}`);
	lines.push(`Average heapUsed delta per test: ${formatMiB(stats.avgHeapDelta)}`);
	lines.push('');

	lines.push('### Top RSS after test');
	lines.push('');
	lines.push('| Test | RSS after | Status |');
	lines.push('| --- | ---: | --- |');
	lines.push(...renderRecordRows(stats.maxRss, (record) => record.memory.after.rss, 'rss'));
	lines.push('');

	lines.push('### Top heapUsed after test');
	lines.push('');
	lines.push('| Test | heapUsed after | Status |');
	lines.push('| --- | ---: | --- |');
	lines.push(...renderRecordRows(stats.maxHeapUsed, (record) => record.memory.after.heapUsed, 'heapUsed'));
	lines.push('');

	lines.push('### Largest RSS increases');
	lines.push('');
	lines.push('| Test | RSS after | RSS delta | Status |');
	lines.push('| --- | ---: | ---: | --- |');
	lines.push(...renderRecordRows(stats.largestRssDelta, (record) => record.memory.delta.rss, 'deltaRss'));
	lines.push('');

	return lines.join('\n');
}

async function main() {
	if (reportFileArg == null || outputFileArg == null) {
		throw new Error('Usage: node .github/scripts/frontend-e2e-memory-report.mts <memory-report.json> <output.md>');
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
