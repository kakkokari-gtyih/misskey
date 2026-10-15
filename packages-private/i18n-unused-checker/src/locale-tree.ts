/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { load as loadYaml } from 'js-yaml';

export type LocaleNode = {
	/** ルートからのキーパス (例: `_notification._types.follow`) */
	path: string;
	children: Map<string, LocaleNode> | null;
	used: boolean;
};

export function isLeaf(node: LocaleNode): boolean {
	return node.children == null;
}

function build(path: string, value: unknown): LocaleNode {
	if (value != null && typeof value === 'object' && !Array.isArray(value)) {
		const children = new Map<string, LocaleNode>();
		for (const [k, v] of Object.entries(value)) {
			children.set(k, build(path === '' ? k : `${path}.${k}`, v));
		}
		return { path, children, used: false };
	}
	return { path, children: null, used: false };
}

export function parseLocaleTree(yaml: string): LocaleNode {
	const root = build('', loadYaml(yaml));
	if (isLeaf(root)) throw new Error('locale YAML のトップレベルがオブジェクトではありません');
	return root;
}

/** 配下の全ノードを使用済みにする */
export function markSubtree(node: LocaleNode): void {
	node.used = true;
	if (node.children) {
		for (const child of node.children.values()) markSubtree(child);
	}
}

export function listUnusedLeaves(root: LocaleNode): string[] {
	const result: string[] = [];
	const walk = (node: LocaleNode) => {
		if (node.children == null) {
			if (!node.used) result.push(node.path);
			return;
		}
		for (const child of node.children.values()) walk(child);
	};
	walk(root);
	return result;
}
