/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Ref } from 'vue';

export type StorageLayer = 'device' | 'deviceAccount' | 'account' | 'profile';

export interface PropertyDef<T> {
	/** デフォルトの保存レイヤー */
	layer: StorageLayer;
	/** 初期値 */
	default: T | (() => T);
	/** ユーザーが変更可能な保存レイヤーのリスト（未指定なら固定） */
	allowedScopes?: StorageLayer[];
	/** ログアウト時にサーバーへ退避するかどうか（デフォルト: false） */
	backup?: boolean;
	/** 値のマージ戦略 */
	mergeStrategy?: (oldValue: T, newValue: T) => T;
}

export type Schema<T = any> = Record<string, PropertyDef<T>>;

// 静的アクセス用（store.s.xxx）の型展開
export type ExtractDefault<S extends Schema> = {
	readonly [K in keyof S]: S[K]['default'];
};

// リアクティブアクセス用（store.r.xxx）の型展開
export type ReactiveState<S extends Schema> = {
	readonly [K in keyof S]: Ref<S[K]['default']>;
};

export interface ManagerInterface<S extends Schema> {
	readonly s: ExtractDefault<S>;
	readonly r: ReactiveState<S>;
	set<K extends keyof S>(key: K, value: S[K]['default']): void;
	model<K extends keyof S>(key: K): Ref<S[K]['default']>;
}

export interface Profile {
	id: string;
	name: string;
	data: Record<string, any>; // 各設定項目の値（theme, fontSize など）が格納される
}

export type BackupSnapshot = {
	_store: Record<string, any>;
	_prefs: Record<string, any>;
	_overrides: Record<string, StorageLayer>;
	_activeProfileId: string;
	_customProfiles: Profile[];
};

export type TabSyncMessage =
	| { type: 'value_changed'; key: string; value: any; accountId: string | null; }
	| { type: 'scope_override_changed'; key: string; layer: StorageLayer; accountId: string | null; }
	| { type: 'active_profile_changed'; profileId: string; accountId: string | null; }
	| { type: 'profiles_list_changed'; profiles: Profile[]; };
