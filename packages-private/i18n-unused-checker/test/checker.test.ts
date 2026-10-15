/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { expect, describe, test } from 'vitest';
import { listUnusedLeaves, parseLocaleTree } from '../src/locale-tree.js';
import { extractChains, extractKeyPathLiterals } from '../src/scanner.js';
import { isIgnored, markChain, markKeyPath } from '../src/checker.js';

const LOCALE = `
ok: "OK"
cancel: "キャンセル"
all: "すべて"
"2fa": "二段階認証"
_notification:
  youWereFollowed: "フォローされました"
  _types:
    follow: "フォロー"
    mention: "メンション"
_ago:
  justNow: "たった今"
  minutesAgo: "{n}分前"
_email:
  _follow:
    title: "フォローされました"
`;

function unusedAfter(src: string): string[] {
	const tree = parseLocaleTree(LOCALE);
	for (const chain of extractChains(src)) markChain(tree, chain);
	for (const segments of extractKeyPathLiterals(src)) markKeyPath(tree, segments);
	return listUnusedLeaves(tree);
}

const ALL_KEYS = [
	'ok',
	'cancel',
	'all',
	'2fa',
	'_notification.youWereFollowed',
	'_notification._types.follow',
	'_notification._types.mention',
	'_ago.justNow',
	'_ago.minutesAgo',
	'_email._follow.title',
];

function without(...used: string[]): string[] {
	return ALL_KEYS.filter(k => !used.includes(k));
}

describe('extractChains', () => {
	test('ドット・オプショナル・ブラケットアクセスを拾う', () => {
		expect(extractChains('i18n.ts?._notification[\'_types\'][type].x')).toEqual([[
			{ kind: 'static', name: 'i18n' },
			{ kind: 'static', name: 'ts' },
			{ kind: 'static', name: '_notification' },
			{ kind: 'static', name: '_types' },
			{ kind: 'dynamic' },
			{ kind: 'static', name: 'x' },
		]]);
	});

	test('改行を挟んだメソッドチェーンを拾う', () => {
		expect(extractChains('i18n\n\t.ts\n\t.ok')).toEqual([[
			{ kind: 'static', name: 'i18n' },
			{ kind: 'static', name: 'ts' },
			{ kind: 'static', name: 'ok' },
		]]);
	});

	test('ネストした括弧を含む動的インデックス', () => {
		const chains = extractChains('i18n.ts._notification[x as typeof y[number]].foo');
		expect(chains[0][3]).toEqual({ kind: 'dynamic' });
		expect(chains[0][4]).toEqual({ kind: 'static', name: 'foo' });
	});

	test('テンプレートリテラルは埋め込みがあれば動的', () => {
		expect(extractChains('a[`_${x}`]')[0][1]).toEqual({ kind: 'dynamic' });
		expect(extractChains('a[`x`]')[0][1]).toEqual({ kind: 'static', name: 'x' });
	});
});

describe('未使用キーの判定', () => {
	test('何も参照しなければ全キーが未使用', () => {
		expect(unusedAfter('')).toEqual(ALL_KEYS);
	});

	test('i18n.ts / i18n.tsx 経由の参照', () => {
		expect(unusedAfter('i18n.ts.ok; i18n.tsx._ago.minutesAgo({ n: 1 }); i18n.ts[\'2fa\'];'))
			.toEqual(without('ok', '_ago.minutesAgo', '2fa'));
	});

	test('Vue テンプレート内の参照', () => {
		expect(unusedAfter('<template><MkButton>{{ i18n.ts.cancel }}</MkButton></template>'))
			.toEqual(without('cancel'));
	});

	test('i18n.ts 以外の後ろにあるトップレベル名は参照とみなさない', () => {
		expect(unusedAfter('Promise.all([]); result.ok;')).toEqual(ALL_KEYS);
	});

	test('動的インデックスは配下すべてを使用済みにする', () => {
		expect(unusedAfter('i18n.ts._notification._types[type]'))
			.toEqual(without('_notification._types.follow', '_notification._types.mention'));
	});

	test('i18n.ts 直下の動的インデックスは全キーを使用済みにする', () => {
		expect(unusedAfter('i18n.ts[key]')).toEqual([]);
	});

	test('オブジェクトで止まった参照 (別名・引数渡し) は配下すべてを使用済みにする', () => {
		expect(unusedAfter('const t = i18n.ts._ago; formatRelativeTime(x, i18n.tsx._ago);'))
			.toEqual(without('_ago.justNow', '_ago.minutesAgo'));
	});

	test('別名経由でも _ 始まりのセクションからたどれる', () => {
		expect(unusedAfter('swI18n.ts?._notification.youWereFollowed; Locale[\'_email\']'))
			.toEqual(without('_notification.youWereFollowed', '_email._follow.title'));
	});

	test('存在しないプロパティで止まった葉は使用済み', () => {
		expect(unusedAfter('i18n.ts.ok.length')).toEqual(without('ok'));
	});

	test('キーパス文字列リテラル', () => {
		expect(unusedAfter('i18n.t(\'_email._follow.title\'); x(\'_notification.unknown\')'))
			.toEqual(without('_email._follow.title'));
	});
});

describe('isIgnored', () => {
	test('完全一致とワイルドカード', () => {
		expect(isIgnored('a.b', ['a.b'])).toBe(true);
		expect(isIgnored('a.bc', ['a.b'])).toBe(false);
		expect(isIgnored('a.b.c', ['a.*'])).toBe(true);
		expect(isIgnored('ab.c', ['a.*'])).toBe(false);
	});
});
