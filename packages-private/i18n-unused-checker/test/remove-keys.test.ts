/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { expect, describe, test } from 'vitest';
import { removeKeys } from '../src/remove-keys.js';

const YAML = [
	'_lang_: "日本語"',
	'',
	'ok: "OK"',
	'cancel: "キャンセル"',
	'"2fa": "二段階認証"',
	'',
	'_ffVisibility:',
	'  public: "公開"',
	'  private: "非公開"',
	'',
	'_notification:',
	'  youWereFollowed: "フォローされました"',
	'  _types:',
	'    follow: "フォロー"',
	'    mention: "メンション"',
	'  login: "ログイン"',
	'',
	'_ago:',
	'  justNow: "たった今"',
	'',
].join('\n');

describe('removeKeys', () => {
	test('トップレベルの葉を削除する', () => {
		expect(removeKeys(YAML, ['cancel', '2fa'])).toBe(YAML.replace('cancel: "キャンセル"\n"2fa": "二段階認証"\n', ''));
	});

	test('ネストした葉を削除する', () => {
		expect(removeKeys(YAML, ['_notification._types.mention'])).toBe(YAML.replace('    mention: "メンション"\n', ''));
	});

	test('子がすべて削除されたセクションは見出しと区切りの空行ごと削除する', () => {
		expect(removeKeys(YAML, ['_ffVisibility.public', '_ffVisibility.private']))
			.toBe(YAML.replace('_ffVisibility:\n  public: "公開"\n  private: "非公開"\n\n', ''));
	});

	test('子がすべて削除された中間のセクションも削除する', () => {
		expect(removeKeys(YAML, ['_notification._types.follow', '_notification._types.mention']))
			.toBe(YAML.replace('  _types:\n    follow: "フォロー"\n    mention: "メンション"\n', ''));
	});

	test('末尾のセクションを削除したら直前の区切りの空行を削除し、末尾の改行は保つ', () => {
		expect(removeKeys(YAML, ['_ago.justNow'])).toBe(YAML.replace('\n_ago:\n  justNow: "たった今"\n', ''));
	});

	test('改行コード CRLF を保つ', () => {
		const crlf = YAML.replaceAll('\n', '\r\n');
		expect(removeKeys(crlf, ['ok'])).toBe(crlf.replace('ok: "OK"\r\n', ''));
	});

	test('存在しないキーを指定するとエラー', () => {
		expect(() => removeKeys(YAML, ['notExist'])).toThrow();
	});
});
