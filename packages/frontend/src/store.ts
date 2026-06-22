/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import { $iId } from '@/i.js';
import type { TIPS } from '@/tips.js';
import { StoreManager } from '@/store/store.js';

/**
 * 「状態」を管理するストア(not「設定」)
 */
export const store = markRaw(new StoreManager($iId, {
	accountSetupWizard: {
		layer: 'account',
		default: 0,
	},
	tips: {
		layer: 'device',
		default: {} as Partial<Record<typeof TIPS[number], boolean>>, // true = 既読
	},
	memo: {
		layer: 'account',
		default: null as string | null,
	},
	reactionAcceptance: {
		layer: 'account',
		default: 'nonSensitiveOnly' as 'likeOnly' | 'likeOnlyForRemote' | 'nonSensitiveOnly' | 'nonSensitiveOnlyForLocalLikeOnlyForRemote' | null,
	},
	mutedAds: {
		layer: 'account',
		default: [] as string[],
	},
	visibility: {
		layer: 'deviceAccount',
		default: 'public' as (typeof Misskey.noteVisibilities)[number],
	},
	localOnly: {
		layer: 'deviceAccount',
		default: false,
	},
	showPreview: {
		layer: 'device',
		default: false,
	},
	tl: {
		layer: 'deviceAccount',
		default: {
			src: 'home' as 'home' | 'local' | 'social' | 'global' | `list:${string}`,
			userList: null as Misskey.entities.UserList | null,
			filter: {
				withReplies: true,
				withRenotes: true,
				withSensitive: true,
				onlyFiles: false,
			},
		},
	},
	darkMode: {
		layer: 'device',
		default: false,
	},
	realtimeMode: {
		layer: 'device',
		default: true,
	},
	recentlyUsedEmojis: {
		layer: 'device',
		default: [] as string[],
	},
	recentlyUsedUsers: {
		layer: 'device',
		default: [] as string[],
	},
	menuDisplay: {
		layer: 'device',
		default: 'sideFull' as 'sideFull' | 'sideIcon'/* | 'top' */,
	},
	postFormWithHashtags: {
		layer: 'device',
		default: false,
	},
	postFormHashtags: {
		layer: 'device',
		default: '',
	},
	additionalUnicodeEmojiIndexes: {
		layer: 'device',
		default: {} as Record<string, Record<string, string[]>>,
	},
	pluginTokens: {
		layer: 'deviceAccount',
		default: {} as Record<string, string>, // plugin id, token
	},
// 端末にログインしている全アカウントのマスターリスト
	accounts: {
		layer: 'device',
		default: [] as { host: string; id: string; username: string; }[]
	},
	// 全アカウントのアクセストークン ("host/userId": "token" のマップ)
	accountTokens: {
		layer: 'device',
		default: {} as Record<string, string>, // host/userId, token
	},
	// 全アカウントのキャッシュ用詳細情報 ("host/userId": MeDetailed のマップ)
	accountInfos: {
		layer: 'device',
		default: {} as Record<string, Misskey.entities.MeDetailed>, // host/userId, MeDetailed
	},
	// 現在アクティブな（画面に表示している）アカウントのID
	activeAccountId: {
		layer: 'device',
		default: null as string | null,
	},

	enablePreferencesAutoCloudBackup: {
		layer: 'device',
		default: false,
	},
	showPreferencesAutoCloudBackupSuggestion: {
		layer: 'device',
		default: true,
	},
	showStoragePersistenceSuggestion: {
		layer: 'device',
		default: true,
	},
}));
