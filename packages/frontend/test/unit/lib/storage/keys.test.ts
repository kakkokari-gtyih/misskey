/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { accountKeyOf, buildKey, parseKey } from '@/lib/storage/keys.js';
import type { ParsedStorageKey } from '@/lib/storage/keys.js';

describe('storage keys', () => {
	describe('buildKey', () => {
		test.each<[string, ParsedStorageKey, string]>([
			['device', { category: 'state', owner: { kind: 'device' }, name: 'base' }, 'mk::state::device::base'],
			['account', { category: 'cache', owner: { kind: 'account', account: 'example.com/abc123' }, name: 'registry-base' }, 'mk::cache::acct:example.com/abc123::registry-base'],
			['server', { category: 'credentials', owner: { kind: 'server', host: 'example.com' }, name: 'token' }, 'mk::credentials::server:example.com::token'],
		])('%s', (_, parsed, raw) => {
			expect(buildKey(parsed)).toBe(raw);
		});
	});

	describe('round trip', () => {
		test.each<ParsedStorageKey>([
			{ category: 'state', owner: { kind: 'device' }, name: 'base' },
			{ category: 'cache', owner: { kind: 'device' }, name: 'a.b.c' },
			{ category: 'state', owner: { kind: 'device' }, name: 'weird::name::with::separators' },
			{ category: 'state', owner: { kind: 'account', account: accountKeyOf('example.com', '9abc') }, name: 'deck' },
			{ category: 'cache', owner: { kind: 'account', account: accountKeyOf('misskey.io', '1') }, name: 'registry-base' },
			{ category: 'credentials', owner: { kind: 'server', host: 'example.com:3000' }, name: 'x' },
		])('%o', (parsed) => {
			expect(parseKey(buildKey(parsed))).toEqual(parsed);
		});
	});

	describe('parseKey returns null for invalid input', () => {
		test.each([
			'',
			'base',
			'pizzax::base',
			'idbfallback::mk::state::device::base',
			'mk::',
			'mk::state',
			'mk::state::device',
			'mk::state::device::', // nameが空
			'mk::unknown::device::base', // 未知のcategory
			'mk::state::unknown::base', // 未知のowner
			'mk::state::acct:example.com::base', // userIdがない
			'mk::state::acct:example.com/::base', // userIdが空
			'mk::state::acct:/abc::base', // hostが空
			'mk::state::server:::base', // hostが空
		])('%j', (raw) => {
			expect(parseKey(raw)).toBeNull();
		});
	});

	test('accountKeyOf', () => {
		expect(accountKeyOf('example.com', 'abc')).toBe('example.com/abc');
	});
});
