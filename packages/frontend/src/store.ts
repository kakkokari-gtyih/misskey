/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import { prefersReducedMotion } from '@@/js/config.js';
import { hemisphere } from '@@/js/intl-const.js';
import type { DeviceKind } from '@/utility/device-kind.js';
import type { TIPS } from '@/tips.js';
import { Pizzax } from '@/lib/pizzax.js';
import { DEFAULT_DEVICE_KIND } from '@/utility/device-kind.js';

/**
 * 「状態」を管理するストア(not「設定」)
 */
export const store = markRaw(new Pizzax('base', {
	accountSetupWizard: {
		where: 'account',
		default: 0,
	},
	tips: {
		where: 'device',
		default: {} as Partial<Record<typeof TIPS[number], boolean>>, // true = 既読
	},
	memo: {
		where: 'account',
		default: null as string | null,
	},
	reactionAcceptance: {
		where: 'account',
		default: 'nonSensitiveOnly' as 'likeOnly' | 'likeOnlyForRemote' | 'nonSensitiveOnly' | 'nonSensitiveOnlyForLocalLikeOnlyForRemote' | null,
	},
	mutedAds: {
		where: 'account',
		default: [] as string[],
	},
	visibility: {
		where: 'deviceAccount',
		default: 'public' as (typeof Misskey.noteVisibilities)[number],
	},
	localOnly: {
		where: 'deviceAccount',
		default: false,
	},
	showPreview: {
		where: 'device',
		default: false,
	},
	tl: {
		where: 'deviceAccount',
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
		where: 'device',
		default: false,
	},
	realtimeMode: {
		where: 'device',
		default: true,
	},
	recentlyUsedEmojis: {
		where: 'device',
		// 嗜好情報ではあるが「誰と関わったか」のような痕跡性は無いので、全ログアウトでも残す
		default: [] as string[],
	},
	recentlyUsedUsers: {
		where: 'device',
		// 「誰と関わったか」がそのまま残るため、全ログアウトでは端末から消す
		sensitive: true,
		default: [] as string[],
	},
	menuDisplay: {
		where: 'device',
		default: 'sideFull' as 'sideFull' | 'sideIcon'/* | 'top' */,
	},
	postFormWithHashtags: {
		where: 'device',
		default: false,
	},
	postFormHashtags: {
		where: 'device',
		// 利用者が書いた文字列がそのまま残るため消す。localStorageの`hashtags`をdeviceWipeに
		// 分類しているのと同じ判断(@/lib/storage/local-storage-manifest.js)
		sensitive: true,
		default: '',
	},
	additionalUnicodeEmojiIndexes: {
		where: 'device',
		// 絵文字の索引付けという嗜好情報に留まり痕跡性は低いので、全ログアウトでも残す
		default: {} as Record<string, Record<string, string[]>>,
	},
	pluginTokens: {
		where: 'deviceAccount',
		default: {} as Record<string, string>, // plugin id, token
	},
	// NOTE: accountTokens / accountInfos は資格情報の台帳(@/accounts/ledger.js)へ移設済み。
	// 移行期間中は旧キー(`mk::state::device::base`)にもdual-writeされるが、
	// storeの定義としては持たない（@/accounts/legacy-ledger.js が直接読み書きする）。

	enablePreferencesAutoCloudBackup: {
		where: 'device',
		default: false,
	},
	showPreferencesAutoCloudBackupSuggestion: {
		where: 'device',
		default: true,
	},
	showStoragePersistenceSuggestion: {
		where: 'device',
		default: true,
	},
}));

// TODO: 他のタブと永続化されたstateを同期

const PREFIX = 'miux:' as const;

interface Watcher {
	key: string;
	callback: (value: unknown) => void;
}
