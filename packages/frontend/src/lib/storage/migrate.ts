/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AccountKey } from '@/lib/storage/keys.js';
import { buildKey } from '@/lib/storage/keys.js';

/**
 * 旧Pizzaxキー（`pizzax::*`）から新しい`mk::`キー空間への移行。
 *
 * ストレージ実体に依存する部分をこのインターフェース越しに閉じ込めてあるので、
 * 移行ロジック本体はインメモリのKVを差し込むだけで単体テストできる。
 */
export type MigrationKv = {
	keys: () => Promise<string[]>;
	get: (key: string) => Promise<any>;
	set: (key: string, val: any) => Promise<void>;
	delMany: (keys: string[]) => Promise<void>;
};

const LEGACY_PREFIX = 'pizzax::';
const CACHE_INFIX = '::cache::';

/** マーカー自身も`mk::`文法に載せておく（列挙・消去の対象判定を一本化するため） */
export const MIGRATION_MARKER_KEY = buildKey({
	category: 'state',
	owner: { kind: 'device' },
	name: 'meta-migration',
});

export const MIGRATION_VERSION = 1;

export type KeyMapping = {
	from: string;
	to: string;
};

function accountOf(host: string, userId: string): AccountKey {
	return `${host}/${userId}`;
}

/**
 * 旧キー一覧から「旧キー → 新キー」の写像を組み立てる純関数。
 *
 * 旧キーはhostを持たない（単一サーバー前提の設計だった）ので、自ホストで補完する。
 */
export function planLegacyKeyMigration(rawKeys: readonly string[], host: string): KeyMapping[] {
	const mappings: KeyMapping[] = [];

	for (const from of rawKeys) {
		if (!from.startsWith(LEGACY_PREFIX)) continue;
		const body = from.slice(LEGACY_PREFIX.length);
		if (body.length === 0) continue;

		// `pizzax::<store>::<id>` と誤認しないよう `::cache::` を先に判定する
		const cacheAt = body.indexOf(CACHE_INFIX);
		if (cacheAt > 0) {
			const storeKey = body.slice(0, cacheAt);
			const userId = body.slice(cacheAt + CACHE_INFIX.length);
			if (userId.length === 0) continue;
			mappings.push({
				from,
				to: buildKey({
					category: 'cache',
					owner: { kind: 'account', account: accountOf(host, userId) },
					name: `registry-${storeKey}`,
				}),
			});
			continue;
		}

		const sepAt = body.indexOf('::');
		if (sepAt > 0) {
			const storeKey = body.slice(0, sepAt);
			const userId = body.slice(sepAt + 2);
			if (userId.length === 0) continue;
			mappings.push({
				from,
				to: buildKey({
					category: 'state',
					owner: { kind: 'account', account: accountOf(host, userId) },
					name: storeKey,
				}),
			});
			continue;
		}

		if (body.includes('::')) continue;

		mappings.push({
			from,
			to: buildKey({
				category: 'state',
				owner: { kind: 'device' },
				name: body,
			}),
		});
	}

	return mappings;
}

export type MigrationResult = {
	/** 実際にコピーしたもの */
	copied: KeyMapping[];
	/** 移行先が既に存在した / 移行元が空だったもの */
	skipped: KeyMapping[];
};

/**
 * copy-if-absent で移行する。旧キーは残したままにするので、
 * 多重実行しても途中でクラッシュした後の再実行でも結果が変わらない（冪等）。
 */
export async function applyLegacyKeyMigration(kv: MigrationKv, host: string): Promise<MigrationResult> {
	const mappings = planLegacyKeyMigration(await kv.keys(), host);
	const copied: KeyMapping[] = [];
	const skipped: KeyMapping[] = [];

	for (const mapping of mappings) {
		if (await kv.get(mapping.to) !== undefined) {
			skipped.push(mapping);
			continue;
		}
		const value = await kv.get(mapping.from);
		if (value === undefined) {
			skipped.push(mapping);
			continue;
		}
		await kv.set(mapping.to, value);
		copied.push(mapping);
	}

	return { copied, skipped };
}

/**
 * 移行本体。マーカーによる早期リターンと旧キー掃除まで含む。
 *
 * @param dropLegacy 移行成功後に旧キーを削除するか。
 *   通常は残す（クラッシュ復元源であり、ロールバックの受け皿でもあるため）が、
 *   localStorageフォールバック環境は容量が約5MBしかないので二重持ちを許容できない。
 */
export async function migrateLegacyKeysWith(kv: MigrationKv, host: string, dropLegacy: boolean): Promise<void> {
	const marker = await kv.get(MIGRATION_MARKER_KEY);
	if (typeof marker === 'number' && marker >= MIGRATION_VERSION) return;

	const { copied, skipped } = await applyLegacyKeyMigration(kv, host);

	// 前回の中断で既にコピー済みだったもの（skipped）も掃除対象に含める
	const legacyKeys = [...copied, ...skipped].map(m => m.from);
	if (dropLegacy && legacyKeys.length > 0) {
		await kv.delMany(legacyKeys);
	}

	// マーカーは最後に書く。途中で落ちたら次回起動でやり直させたいため
	await kv.set(MIGRATION_MARKER_KEY, MIGRATION_VERSION);
}

let migrationPromise: Promise<void> | null = null;

/**
 * boot時に一度だけ実行する入口。Pizzaxインスタンスは複数あり各々がinit()するので、
 * モジュールスコープのPromiseで単一実行を保証する。
 *
 * 失敗しても例外を投げない（boot自体を止めない）。マーカーを書かずに終わるため次回起動で再試行される。
 */
export function migrateLegacyKeys(): Promise<void> {
	if (migrationPromise != null) return migrationPromise;

	migrationPromise = (async () => {
		try {
			const kvModule = await import('@/lib/storage/kv.js');
			const { host } = await import('@@/js/config.js');

			const kv: MigrationKv = {
				keys: kvModule.listRawKeys,
				get: kvModule.get,
				set: kvModule.set,
				delMany: kvModule.delMany,
			};
			const dropLegacy = !kvModule.isIdbAvailable();

			const run = () => migrateLegacyKeysWith(kv, host, dropLegacy);

			// タブ間で同時に走らせても無駄なだけなので、取れたタブだけが実行する。
			// 取れなかった側は素通ししてはいけない（移行前の空の状態を読んでしまう）ので、
			// 保持側の完了を待ってから入り、マーカーで即座に抜ける。
			// 手順自体は冪等なので、Web Locks非対応環境ではロックなしでそのまま走らせてよい
			// 型上は必ず存在することになっているが、非セキュアコンテキストや古いSafariでは実際には無い
			const locks = (navigator as Partial<Navigator>).locks;
			if (locks != null) {
				const acquired = await locks.request('mk-storage-migration', { ifAvailable: true }, async lock => {
					if (lock == null) return false;
					await run();
					return true;
				});
				if (!acquired) {
					await locks.request('mk-storage-migration', run);
				}
			} else {
				await run();
			}
		} catch (err) {
			console.error('failed to migrate legacy storage keys', err);
		}
	})();

	return migrationPromise;
}
