// @ts-check

/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * クライアント向け言語ファイル (/locales) をビルド時に扱うためのヘルパー (Node.js 専用)
 *
 * tsx / vite / Node.js から同じ指定子で読めるよう、型は locales.d.ts に分けている
 */

import { fileURLToPath } from 'node:url';
import { loadLocales } from 'i18n/build';

export const localesDir = fileURLToPath(new URL('../../locales/', import.meta.url));

/**
 * フォールバック解決済みのクライアント向け言語データを読み込む
 *
 * 呼び出すたびに全言語を読み込むので、ビルドツールなどから必要な回数だけ呼ぶこと
 */
export function loadFrontendLocales() {
	return loadLocales(localesDir);
}
