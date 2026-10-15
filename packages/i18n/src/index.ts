/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 実行時 (ブラウザ / Node.js) から参照される言語定義と型
 *
 * 翻訳データ自体は持たない。言語ファイルの読み込み・型生成は `i18n/build` を参照
 */

export { languages, primaries } from './const.js';
export type { Language } from './const.js';
export type { ILocale, ParameterizedString } from './types.js';
