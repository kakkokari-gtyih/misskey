/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { keys as ikeys } from 'idb-keyval';
import type { ParsedStorageKey } from '@/lib/storage/keys.js';
import { get, set, delMany, isIdbAvailable, FALLBACK_PREFIX } from '@/utility/idb-proxy.js';
import { parseKey } from '@/lib/storage/keys.js';

export { get, set, delMany, isIdbAvailable };

/**
 * ストレージ実体のキーを全て列挙する。
 * idb-proxyはkeys()相当を持たないので、ここだけは実体（idb-keyval / localStorage）を直接見る。
 */
export async function listRawKeys(): Promise<string[]> {
	if (isIdbAvailable()) {
		return (await ikeys()).map(k => String(k));
	}

	// フォールバック時はlocalStorage上に FALLBACK_PREFIX 付きで載っているので剥がして返す
	const result: string[] = [];
	const ls = window.localStorage;
	for (let i = 0; i < ls.length; i++) {
		const k = ls.key(i);
		if (k != null && k.startsWith(FALLBACK_PREFIX)) {
			result.push(k.slice(FALLBACK_PREFIX.length));
		}
	}
	return result;
}

/** `mk::`文法に載っているキーだけを返す。管理外のキーには一切触れないための入口 */
export async function listManagedKeys(): Promise<ParsedStorageKey[]> {
	const result: ParsedStorageKey[] = [];
	for (const raw of await listRawKeys()) {
		const parsed = parseKey(raw);
		if (parsed != null) result.push(parsed);
	}
	return result;
}
