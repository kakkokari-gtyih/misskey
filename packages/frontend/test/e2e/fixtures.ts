/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { test as base, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IGNORABLE_ERROR_MESSAGES, isIgnorableErrorMessage } from './ignorable-errors.js';

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

const defaultMemoryReportPath = fileURLToPath(new URL('./artifacts/memory-per-test.json', import.meta.url));
const memoryReportPath = process.env.PLAYWRIGHT_E2E_MEMORY_REPORT_PATH ?? defaultMemoryReportPath;

function getMemorySnapshot(): MemorySnapshot {
	const usage = process.memoryUsage();
	return {
		rss: usage.rss,
		heapTotal: usage.heapTotal,
		heapUsed: usage.heapUsed,
		external: usage.external,
		arrayBuffers: usage.arrayBuffers,
	};
}

function getDelta(before: MemorySnapshot, after: MemorySnapshot): MemorySnapshot {
	return {
		rss: after.rss - before.rss,
		heapTotal: after.heapTotal - before.heapTotal,
		heapUsed: after.heapUsed - before.heapUsed,
		external: after.external - before.external,
		arrayBuffers: after.arrayBuffers - before.arrayBuffers,
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
	_recordMemoryUsage: [async ({}, use, testInfo) => {
		const before = getMemorySnapshot();
		const startedAt = Date.now();

		await use();

		const after = getMemorySnapshot();
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
