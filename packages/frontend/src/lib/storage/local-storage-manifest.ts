/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Keys } from '@/local-storage.js';

export type ManifestEntry = {
	category: 'state' | 'cache' | 'credentials' | 'preferences';
	/**
	 * persistent  = 全ログアウトでも残す（言語・テーマ等、アカウントと無関係な端末設定）
	 * deviceWipe  = 全ログアウトで消す
	 */
	erasure: 'persistent' | 'deviceWipe';
};

/**
 * テンプレートリテラル型（`miux:${string}`等）はRecordのキーにできないので、
 * `Keys`からそれらを差し引いた「固定リテラルキー」だけをこのテーブルで網羅する。
 * こうしておくとlocal-storage.tsにリテラルキーを足したのにここへ分類を書き忘れた場合に
 * コンパイルエラーになる（網羅性の型による強制）。プレフィックス系は下のテーブルで扱う。
 */
type LiteralOnly = Exclude<Keys,
	`miux:${string}` |
	`ui:folder:${string}` |
	`themes:${string}` |
	`aiscript:${string}` |
	`channelLastReadedAt:${string}` |
	`idbfallback::${string}`
>;

export const localStorageManifest = {
	account: { category: 'credentials', erasure: 'deviceWipe' },

	preferences: { category: 'preferences', erasure: 'deviceWipe' },

	latestDonationInfoShownAt: { category: 'state', erasure: 'persistent' },
	neverShowDonationInfo: { category: 'state', erasure: 'persistent' },
	neverShowLocalOnlyInfo: { category: 'state', erasure: 'persistent' },
	modifiedVersionMustProminentlyOfferInAgplV3Section13Read: { category: 'state', erasure: 'persistent' },
	lang: { category: 'state', erasure: 'persistent' },
	colorScheme: { category: 'state', erasure: 'persistent' },
	useSystemFont: { category: 'state', erasure: 'persistent' },
	fontSize: { category: 'state', erasure: 'persistent' },
	ui: { category: 'state', erasure: 'persistent' },
	bootloaderLocales: { category: 'state', erasure: 'persistent' },
	debug: { category: 'state', erasure: 'persistent' },
	isSafeMode: { category: 'state', erasure: 'persistent' },

	// 以下はユーザーが書いた内容（sensitive相当）なので端末からは消したい。
	// ただし現状これらはアカウントに紐付いていないため、単体アカウントのログアウトでは
	// 消しようがない（消すと他アカウントの下書きまで巻き込む）という既知の限界がある。
	// アカウント単位のキー空間へ移すのは後続マイルストーンの課題。
	// 全ログアウトでは`preferences`（プロファイル本体）が消えるので、抑止フラグだけ残ると
	// 「バックアップはあるのに復元提案が二度と出ない」状態になる。フラグも一緒に消す。
	hidePreferencesRestoreSuggestion: { category: 'state', erasure: 'deviceWipe' },

	drafts: { category: 'state', erasure: 'deviceWipe' },
	chatMessageDrafts: { category: 'state', erasure: 'deviceWipe' },
	scratchpad: { category: 'state', erasure: 'deviceWipe' },
	hashtags: { category: 'state', erasure: 'deviceWipe' },

	v: { category: 'cache', erasure: 'deviceWipe' },
	lastVersion: { category: 'cache', erasure: 'deviceWipe' },
	instance: { category: 'cache', erasure: 'deviceWipe' },
	instanceCachedAt: { category: 'cache', erasure: 'deviceWipe' },
	theme: { category: 'cache', erasure: 'deviceWipe' },
	themeId: { category: 'cache', erasure: 'deviceWipe' },
	themeCachedVersion: { category: 'cache', erasure: 'deviceWipe' },
	customCss: { category: 'cache', erasure: 'deviceWipe' },
	ui_temp: { category: 'cache', erasure: 'deviceWipe' },
	lastEmojisFetchedAt: { category: 'cache', erasure: 'deviceWipe' },
	emojis: { category: 'cache', erasure: 'deviceWipe' },
	lastUsed: { category: 'cache', erasure: 'deviceWipe' },
	latestPreferencesUpdate: { category: 'cache', erasure: 'deviceWipe' },
} as const satisfies Record<LiteralOnly, ManifestEntry>;

/**
 * プレフィックス付きキー。長いものが先に来るよう並べ、前方一致で先勝ちさせる。
 *
 * `idbfallback::`はここに載せない。idbが使えない環境でのkv層の実体そのものであり、
 * 中身の消去判断はkv側のparseKey（`mk::`文法）に委ねるべきだから。
 */
const prefixManifest: readonly (readonly [string, ManifestEntry])[] = [
	['ui:folder:', { category: 'state', erasure: 'persistent' }],
	['miux:', { category: 'state', erasure: 'deviceWipe' }], // 旧設定
	['themes:', { category: 'cache', erasure: 'deviceWipe' }],
	['aiscript:', { category: 'state', erasure: 'deviceWipe' }],
	['channelLastReadedAt:', { category: 'state', erasure: 'deviceWipe' }],
];

/**
 * リテラル → プレフィックスの順に解決する。
 * 未知のキーはnullを返す。呼び出し側では保守的にdeviceWipe扱い（＝消す側）に倒すこと。
 * 残してよいものだけを明示的に台帳へ載せる運用にしないと、消し漏れが恒久的に残るため。
 */
export function classifyLocalStorageKey(key: string): ManifestEntry | null {
	if (Object.prototype.hasOwnProperty.call(localStorageManifest, key)) {
		return localStorageManifest[key as keyof typeof localStorageManifest];
	}

	for (const [prefix, entry] of prefixManifest) {
		if (key.startsWith(prefix)) return entry;
	}

	return null;
}
