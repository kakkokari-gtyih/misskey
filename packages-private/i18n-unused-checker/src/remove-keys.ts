/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { listLeaves, parseLocaleTree } from './locale-tree.js';
import type { LocaleNode } from './locale-tree.js';

/**
 * 書式 (クォート・空行・コメント) を保つため、YAML を再出力せず行単位で削除する。
 * 1 行 1 キーのブロック形式 (`key: value` / `key:` + インデントされた子) を前提とする。
 */

const KEY_LINE = /^( *)(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#"'][^:]*?)):(?:\s|$)/;

type KeyLine = {
	path: string;
	indent: number;
	/** このキーのブロック (子を含む) の行範囲 [start, end) */
	start: number;
	end: number;
};

function parseKeyLines(lines: string[]): KeyLine[] {
	const result: KeyLine[] = [];
	const stack: KeyLine[] = [];
	const close = (until: number, indent: number) => {
		while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
			const entry = stack.pop()!;
			// ブロック末尾の空行・コメント行は後続側に残す
			let end = until;
			while (end > entry.start + 1 && /^\s*(#.*)?$/.test(lines[end - 1])) end--;
			entry.end = end;
		}
	};

	lines.forEach((line, i) => {
		const m = KEY_LINE.exec(line);
		if (m == null) return;
		const indent = m[1].length;
		close(i, indent);
		const name = m[2] != null ? JSON.parse(`"${m[2]}"`) as string : m[3] != null ? m[3].replaceAll('\'\'', '\'') : m[4];
		const parent = stack.at(-1);
		const entry: KeyLine = { path: parent ? `${parent.path}.${name}` : name, indent, start: i, end: -1 };
		stack.push(entry);
		result.push(entry);
	});
	close(lines.length, 0);
	return result;
}

/** 配下の葉がすべて削除対象なら、そのノード自体を削除対象にする */
function collectRemovableRoots(node: LocaleNode, leaves: ReadonlySet<string>, out: Set<string>): boolean {
	if (node.children == null) {
		if (leaves.has(node.path)) out.add(node.path);
		return leaves.has(node.path);
	}
	const childResults = [...node.children.values()].map(child => collectRemovableRoots(child, leaves, out));
	const allRemoved = childResults.length > 0 && childResults.every(Boolean);
	if (allRemoved && node.path !== '') {
		for (const child of node.children.values()) out.delete(child.path);
		out.add(node.path);
	}
	return allRemoved;
}

/**
 * `yaml` から `keys` (葉のキーパス) を削除したテキストを返す。子がすべて削除されたセクションも削除する。
 * 削除結果を再パースし、指定したキー以外が失われていないことを検証する。
 */
export function removeKeys(yaml: string, keys: readonly string[]): string {
	const tree = parseLocaleTree(yaml);
	const targets = new Set<string>();
	collectRemovableRoots(tree, new Set(keys), targets);

	const eol = yaml.includes('\r\n') ? '\r\n' : '\n';
	const lines = yaml.split(/\r?\n/);
	const remove = new Array<boolean>(lines.length).fill(false);
	const found = new Set<string>();
	for (const entry of parseKeyLines(lines)) {
		if (!targets.has(entry.path)) continue;
		found.add(entry.path);
		for (let i = entry.start; i < entry.end; i++) remove[i] = true;
		// トップレベルのセクションを消したときに区切りの空行が重複しないようにする
		// (split の都合で最終要素は末尾の改行を表すので消さない。末尾のブロックなら直前の空行を消す)
		const blank = (i: number) => i >= 0 && i < lines.length - 1 && !remove[i] && lines[i].trim() === '';
		const atEof = lines.slice(entry.end).every(line => line.trim() === '');
		if (atEof && blank(entry.start - 1)) remove[entry.start - 1] = true;
		else if (blank(entry.end) && (entry.start === 0 || blank(entry.start - 1))) remove[entry.end] = true;
	}

	const missing = [...targets].filter(path => !found.has(path));
	if (missing.length > 0) throw new Error(`YAML 上で行を特定できないキーがあります: ${missing.join(', ')}`);

	const result = lines.filter((_, i) => !remove[i]).join(eol);

	// 削除前後の葉の差分が指定したキーと一致することを確認する
	const before = listLeaves(tree).map(node => node.path);
	const after = new Set(listLeaves(parseLocaleTree(result)).map(node => node.path));
	const removed = before.filter(path => !after.has(path));
	const expected = new Set(keys);
	if (removed.length !== expected.size || removed.some(path => !expected.has(path)) || after.size !== before.length - expected.size) {
		throw new Error('キーの削除結果が想定と一致しません。YAML の書式を確認してください。');
	}

	return result;
}
