/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	MIGRATION_MARKER_KEY,
	MIGRATION_VERSION,
	applyLegacyKeyMigration,
	migrateLegacyKeysWith,
	planLegacyKeyMigration,
} from '@/lib/storage/migrate.js';
import type { MigrationKv } from '@/lib/storage/migrate.js';

const HOST = 'example.com';

function memoryKv(initial: Record<string, any> = {}): MigrationKv & { dump: () => Record<string, any> } {
	const store = new Map<string, any>(Object.entries(initial));
	return {
		keys: async () => [...store.keys()],
		get: async (key) => store.get(key),
		set: async (key, val) => { store.set(key, val); },
		delMany: async (keys) => { for (const k of keys) store.delete(k); },
		dump: () => Object.fromEntries(store),
	};
}

describe('planLegacyKeyMigration', () => {
	test.each<[string, string | null]>([
		['pizzax::base', 'mk::state::device::base'],
		['pizzax::deck', 'mk::state::device::deck'],
		['pizzax::base::9abc', 'mk::state::acct:example.com/9abc::base'],
		['pizzax::deck::9abc', 'mk::state::acct:example.com/9abc::deck'],
		['pizzax::base::cache::9abc', 'mk::cache::acct:example.com/9abc::registry-base'],
		['pizzax::deck::cache::9abc', 'mk::cache::acct:example.com/9abc::registry-deck'],
		// 管理外・壊れたキーは拾わない
		['pizzax::', null],
		['pizzax::base::', null],
		['pizzax::base::cache::', null],
		['mk::state::device::base', null],
		['someOtherKey', null],
	])('%s', (from, to) => {
		const [mapping] = planLegacyKeyMigration([from], HOST);
		if (to == null) {
			expect(mapping).toBeUndefined();
		} else {
			expect(mapping).toEqual({ from, to });
		}
	});

	test('::cache:: を含むキーがアカウントキーと誤認されない', () => {
		const mappings = planLegacyKeyMigration(['pizzax::base::cache::9abc', 'pizzax::base::9abc'], HOST);
		expect(mappings.map(m => m.to)).toEqual([
			'mk::cache::acct:example.com/9abc::registry-base',
			'mk::state::acct:example.com/9abc::base',
		]);
	});
});

describe('applyLegacyKeyMigration', () => {
	test('旧キーの値が新キーへ写る', async () => {
		const kv = memoryKv({
			'pizzax::base': { a: 1 },
			'pizzax::base::9abc': { b: 2 },
			'pizzax::base::cache::9abc': { c: 3 },
		});

		await applyLegacyKeyMigration(kv, HOST);

		expect(kv.dump()).toMatchObject({
			'mk::state::device::base': { a: 1 },
			'mk::state::acct:example.com/9abc::base': { b: 2 },
			'mk::cache::acct:example.com/9abc::registry-base': { c: 3 },
			// 旧キーは残す
			'pizzax::base': { a: 1 },
		});
	});

	test('copy-if-absent: 既に新キーがあれば上書きしない', async () => {
		const kv = memoryKv({
			'pizzax::base': { a: 1 },
			'mk::state::device::base': { a: 999 },
		});

		const result = await applyLegacyKeyMigration(kv, HOST);

		expect(result.copied).toHaveLength(0);
		expect(await kv.get('mk::state::device::base')).toEqual({ a: 999 });
	});

	test('冪等: 2回適用しても結果が変わらない', async () => {
		const kv = memoryKv({
			'pizzax::base': { a: 1 },
			'pizzax::deck::cache::9abc': { c: 3 },
		});

		await applyLegacyKeyMigration(kv, HOST);
		const afterFirst = kv.dump();
		const second = await applyLegacyKeyMigration(kv, HOST);

		expect(second.copied).toHaveLength(0);
		expect(kv.dump()).toEqual(afterFirst);
	});

	test('部分適用状態から再開できる', async () => {
		const kv = memoryKv({
			'pizzax::base': { a: 1 },
			'pizzax::base::9abc': { b: 2 },
			// 1件目だけ済んでいる状態でクラッシュしたと想定
			'mk::state::device::base': { a: 1 },
		});

		const result = await applyLegacyKeyMigration(kv, HOST);

		expect(result.copied.map(m => m.to)).toEqual(['mk::state::acct:example.com/9abc::base']);
		expect(await kv.get('mk::state::acct:example.com/9abc::base')).toEqual({ b: 2 });
	});
});

describe('migrateLegacyKeysWith', () => {
	test('マーカーが書かれる', async () => {
		const kv = memoryKv({ 'pizzax::base': { a: 1 } });
		await migrateLegacyKeysWith(kv, HOST, false);
		expect(await kv.get(MIGRATION_MARKER_KEY)).toBe(MIGRATION_VERSION);
	});

	test('マーカー済みなら何もしない', async () => {
		const kv = memoryKv({
			'pizzax::base': { a: 1 },
			[MIGRATION_MARKER_KEY]: MIGRATION_VERSION,
		});
		await migrateLegacyKeysWith(kv, HOST, false);
		expect(await kv.get('mk::state::device::base')).toBeUndefined();
	});

	test('dropLegacy時のみ旧キーを消す', async () => {
		const kept = memoryKv({ 'pizzax::base': { a: 1 } });
		await migrateLegacyKeysWith(kept, HOST, false);
		expect(await kept.get('pizzax::base')).toEqual({ a: 1 });

		const dropped = memoryKv({ 'pizzax::base': { a: 1 } });
		await migrateLegacyKeysWith(dropped, HOST, true);
		expect(await dropped.get('pizzax::base')).toBeUndefined();
		expect(await dropped.get('mk::state::device::base')).toEqual({ a: 1 });
	});

	test('set失敗（容量超過等）ではマーカーを書かない', async () => {
		const kv = memoryKv({ 'pizzax::base': { a: 1 } });
		const failing: MigrationKv = {
			...kv,
			set: async (key, val) => {
				if (key.startsWith('mk::state::device::base')) throw new Error('QuotaExceededError');
				return kv.set(key, val);
			},
		};

		await expect(migrateLegacyKeysWith(failing, HOST, false)).rejects.toThrow();
		expect(await kv.get(MIGRATION_MARKER_KEY)).toBeUndefined();
	});
});
