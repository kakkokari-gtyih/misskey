/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { emojiRegex as twemojiRegex } from '@misskey-dev/emoji-data/regex';

export const emojiRegex = new RegExp(`(${twemojiRegex.source})`);

export function colorizeEmoji(text: string): string {
  const targetClass = '\\p{Emoji}--[\\p{Emoji_Presentation}\\p{Regional_Indicator}\\p{Emoji_Modifier}\\u{1F9B0}-\\u{1F9B3}\\u{E0020}-\\u{E007F}]';
  const regex = new RegExp(`([${targetClass}])(?:\\uFE0E|(?!\\uFE0F|\\p{Emoji_Modifier}))`, 'gv');
  return text.replace(regex, '$1\uFE0F');
}

export function normalizeEmoji(text: string): string | null {
	// emojiRegexがVS16付きを期待するため、一度VS16を付与
	const colorized = colorizeEmoji(text);

	const match = emojiRegex.exec(colorized);

	if (match) {
		// 合字を含む一つの絵文字
		const unicode = match[0];

		// 異体字セレクタ除去（要らない場合はVS16を消す）
		return unicode.match('\u200d') ? unicode : unicode.replace(/\ufe0f/g, '');
	} else {
		return null;
	}
}
