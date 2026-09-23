/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export function stripHtmlTags(text: string): string {
	return text.replace(/<[^>]*>/g, '');
}
