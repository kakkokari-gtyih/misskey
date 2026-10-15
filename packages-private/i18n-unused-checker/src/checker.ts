/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isLeaf, markSubtree } from './locale-tree.js';
import type { LocaleNode } from './locale-tree.js';
import type { Chain } from './scanner.js';

/** この名前のプロパティの直後に続くセグメントはトップレベルのキーとみなす (`i18n.ts.foo` / `i18n.tsx.foo()`) */
const ROOT_ACCESSORS = new Set(['ts', 'tsx']);

function prevName(chain: Chain, i: number): string | null {
	const seg = chain[i - 1] as Chain[number] | undefined;
	return seg?.kind === 'static' ? seg.name : null;
}

/**
 * `node` から `chain[from]` 以降をたどって使用済みにする。
 * - 末端が葉ならその葉のみ
 * - 途中に動的インデックスがある、または途中のオブジェクトで止まった (別名に代入・引数に渡した等) なら配下すべて
 */
function walk(node: LocaleNode, chain: Chain, from: number): void {
	let current = node;
	for (let i = from; i < chain.length; i++) {
		const seg = chain[i];
		if (seg.kind === 'dynamic') break;
		const child = current.children?.get(seg.name);
		if (child == null) break;
		current = child;
	}
	if (isLeaf(current)) current.used = true;
	else markSubtree(current);
}

/**
 * チェーン中の各位置について、トップレベルのキーとして解釈できるものをすべて使用済みにする。
 *
 * トップレベルのキーとみなす条件:
 * - `ts` / `tsx` の直後 (`i18n.ts.foo`, `i18n.tsx.foo()`, `ts.foo`)
 * - `_` 始まりのセクション名 (`_notification` 等。別名経由の `x._notification.foo` や
 *   型の `Locale['_bootErrors']` も拾うため、直前の名前は問わない)
 */
export function markChain(root: LocaleNode, chain: Chain): void {
	for (let i = 0; i < chain.length; i++) {
		const seg = chain[i];
		const afterRoot = ROOT_ACCESSORS.has(prevName(chain, i) ?? '');
		if (seg.kind === 'dynamic') {
			// `i18n.ts[key]` はどのキーでもありうる
			if (afterRoot && prevName(chain, i - 1) === 'i18n') markSubtree(root);
			continue;
		}
		const top = root.children?.get(seg.name);
		if (top == null) continue;
		if (afterRoot || seg.name.startsWith('_')) walk(top, chain, i + 1);
	}
}

/** `'_email._follow.title'` のようなキーパス文字列。ルートから完全に解決できるものだけを対象にする */
export function markKeyPath(root: LocaleNode, segments: string[]): void {
	let current: LocaleNode | undefined = root;
	for (const name of segments) {
		current = current.children?.get(name);
		if (current == null) return;
	}
	if (isLeaf(current)) current.used = true;
	else markSubtree(current);
}

/**
 * 未使用扱いから除外するキー。`foo.bar` は完全一致、`foo.*` は配下すべてにマッチする。
 * ソースコードから参照されないが意図的に残しているキーがあればここに追加する。
 */
export function isIgnored(key: string, patterns: readonly string[]): boolean {
	return patterns.some(p => p.endsWith('.*') ? key.startsWith(p.slice(0, -1)) : key === p);
}
