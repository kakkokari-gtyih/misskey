/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowRef, computed, markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { get, set } from '@/utility/idb-proxy.js';

const storageCache = await get('emojis');
export const customEmojis = shallowRef<Misskey.entities.EmojiSimple[]>(Array.isArray(storageCache) ? storageCache : []);
export const customEmojiCategories = computed<[ ...string[], null ]>(() => {
	const categories = new Set<string>();
	for (const emoji of customEmojis.value) {
		if (emoji.category && emoji.category !== 'null') {
			categories.add(emoji.category);
		}
	}
	return markRaw([...Array.from(categories), null]);
});

// customEmojis が shallowRef なので問題ないが、そうでなくなった場合は値の変化で computed が乱発される可能性があるので要注意
export const customEmojisMap = computed(() => {
	const map = new Map<string, Misskey.entities.EmojiSimple>();
	for (const emoji of customEmojis.value) {
		map.set(emoji.name, emoji);
	}
	return markRaw(map);
});

let cachedTags: string[] | null = null;

function setCustomEmojis(emojis: Misskey.entities.EmojiSimple[]) {
	customEmojis.value = emojis;
	cachedTags = null;
	set('emojis', emojis);
}

export function addCustomEmoji(emoji: Misskey.entities.EmojiSimple) {
	setCustomEmojis([emoji, ...customEmojis.value]);
}

export function updateCustomEmojis(emojis: Misskey.entities.EmojiSimple[]) {
	setCustomEmojis(customEmojis.value.map(item => emojis.find(search => search.name === item.name) ?? item));
}

export function removeCustomEmojis(emojis: Misskey.entities.EmojiSimple[]) {
	setCustomEmojis(customEmojis.value.filter(item => !emojis.some(search => search.name === item.name)));
}

function isSameStats(a: Misskey.entities.EmojisStatsResponse | null | undefined, b: Misskey.entities.EmojisStatsResponse) {
	// lastUpdatedAt はサーバー時刻の巻き戻しや古い updatedAt のまま復元する操作で単調増加とは限らないため大小比較ではいけない
	return a != null && a.count === b.count && a.lastUpdatedAt === b.lastUpdatedAt;
}

export async function fetchCustomEmojis(force = false) {
	const stats = await misskeyApi('emojis/stats');
	if (!force && isSameStats(await get('emojisStats'), stats)) return;

	// GETだとキャッシュで古いリストが返ってきうるのでPOST
	const res = await misskeyApi('emojis');

	setCustomEmojis(res.emojis);
	set('emojisStats', stats);
}

export function getCustomEmojiTags() {
	if (cachedTags) return cachedTags;

	const tags = new Set<string>();
	for (const emoji of customEmojis.value) {
		for (const tag of emoji.aliases) {
			tags.add(tag);
		}
	}
	const res = Array.from(tags);
	cachedTags = res;
	return res;
}
