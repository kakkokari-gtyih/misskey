/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { languages, primaries } from './const.js';
import type { Language } from './const.js';

/**
 * 任意の言語タグ (例: プロフィールの言語設定 `fr`, `ar-AR`) を、翻訳が存在する言語に寄せる
 *
 * 1. 完全一致すればそれを使う
 * 2. 言語部分が一致すれば、その言語の primary (例: `en` → `en-US`)、なければ最初に見つかった地域を使う
 * 3. いずれも無ければ `fallback`
 */
export function normalizeLanguage(lang: string | null | undefined, fallback: Language = 'en-US'): Language {
	if (lang == null || lang === '') return fallback;

	const exact = languages.find(l => l === lang);
	if (exact != null) return exact;

	const primaryLang = lang.split('-')[0].toLowerCase();
	if (primaryLang in primaries) {
		return `${primaryLang}-${primaries[primaryLang as keyof typeof primaries]}` as Language;
	}

	return languages.find(l => l.split('-')[0] === primaryLang) ?? fallback;
}
