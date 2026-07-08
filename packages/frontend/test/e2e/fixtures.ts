/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IGNORABLE_ERROR_MESSAGES, isIgnorableErrorMessage } from './ignorable-errors.js';

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

const defaultMemoryReportPath = fileURLToPath(new URL('./artifacts/memory-per-test.json', import.meta.url));
const memoryReportPath = process.env.PLAYWRIGHT_E2E_MEMORY_REPORT_PATH ?? defaultMemoryReportPath;

function getMetricValue(metrics: Array<{ name: string; value: number }>, name: string): number | null {
	const metric = metrics.find((item) => item.name === name);
	if (metric == null || !Number.isFinite(metric.value)) return null;
	return metric.value;
}

async function getMemorySnapshot(page: Page): Promise<MemorySnapshot> {
	const cdpSession = await page.context().newCDPSession(page);

	try {
		await cdpSession.send('Performance.enable');
		const result = await cdpSession.send('Performance.getMetrics') as {
			metrics: Array<{ name: string; value: number }>;
		};

		const metrics = result.metrics ?? [];
		return {
			jsHeapUsedSize: getMetricValue(metrics, 'JSHeapUsedSize'),
			jsHeapTotalSize: getMetricValue(metrics, 'JSHeapTotalSize'),
		};
	} catch {
		return {
			jsHeapUsedSize: null,
			jsHeapTotalSize: null,
		};
	} finally {
		await cdpSession.detach().catch(() => undefined);
	}
}

function getDeltaValue(before: number | null, after: number | null): number | null {
	if (before == null || after == null) return null;
	if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
	return after - before;
}

function getDelta(before: MemorySnapshot, after: MemorySnapshot): MemorySnapshot {
	return {
		jsHeapUsedSize: getDeltaValue(before.jsHeapUsedSize, after.jsHeapUsedSize),
		jsHeapTotalSize: getDeltaValue(before.jsHeapTotalSize, after.jsHeapTotalSize),
	};
}

async function appendMemoryRecord(record: MemoryRecord): Promise<void> {
	await mkdir(dirname(memoryReportPath), { recursive: true });

	let records: MemoryRecord[] = [];
	try {
		const previous = await readFile(memoryReportPath, 'utf8');
		const parsed = JSON.parse(previous) as { records?: MemoryRecord[] };
		records = Array.isArray(parsed.records) ? parsed.records : [];
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
			throw error;
		}
	}

	records.push(record);

	console.log(`Writing memory report to ${memoryReportPath} (total records: ${records.length})`);

	await writeFile(memoryReportPath, `${JSON.stringify({
		generatedAt: new Date().toISOString(),
		reportPath: memoryReportPath,
		records,
	}, null, 2)}\n`);
}

/** 通常のtestの代わりにこちらを使用する */
export const test = base.extend<{ _installIgnorableErrorHandlers: void; _recordMemoryUsage: void }>({
	_installIgnorableErrorHandlers: [async ({ page }, use) => {
		await page.addInitScript((messages) => {
			function includesIgnorableMessage(message: unknown): boolean {
				if (typeof message !== 'string') return false;
				return messages.some((text) => message.includes(text));
			}

			window.addEventListener('error', (event) => {
				if (includesIgnorableMessage(event.message)) {
					event.preventDefault();
				}
			});

			window.addEventListener('unhandledrejection', (event) => {
				const reason = event.reason;
				const message = reason instanceof Error ? reason.message : String(reason);
				if (includesIgnorableMessage(message)) {
					event.preventDefault();
				}
			});
		}, [...IGNORABLE_ERROR_MESSAGES]);

		// Playwright側で収集されるページエラーも同じ基準で握りつぶす。
		page.on('pageerror', (error) => {
			if (isIgnorableErrorMessage(error.message)) {
				return;
			}
		});

		await use();
	}, { auto: true }],
	_recordMemoryUsage: [async ({ page }, use, testInfo) => {
		const before = await getMemorySnapshot(page);
		const startedAt = Date.now();

		await use();

		const after = await getMemorySnapshot(page);
		const durationMs = Date.now() - startedAt;
		const displayTitle = `${testInfo.file} > ${testInfo.title}`;

		await appendMemoryRecord({
			test: {
				id: testInfo.testId,
				title: displayTitle,
				file: testInfo.file,
				project: testInfo.project.name,
				durationMs,
				status: testInfo.status ?? 'unknown',
				retry: testInfo.retry,
			},
			timestamp: new Date().toISOString(),
			memory: {
				before,
				after,
				delta: getDelta(before, after),
			},
		});
	}, { auto: true }],
});

export { expect };
