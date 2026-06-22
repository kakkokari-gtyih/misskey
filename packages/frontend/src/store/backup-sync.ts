/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { StoreManager } from '@/store/store.js';
import { PreferencesManager } from '@/store/preference.js';
import type { BackupSnapshot, Schema } from '@/store/types.js';
import { localDatabase } from '@/store/storage.js';
import { misskeyApi } from '@/utility/misskey-api.js';

export class BackupSyncEngine {
	constructor(
		private store: StoreManager<any>,
		private prefs: PreferencesManager<any>,
		private schemaStore: Schema,
		private schemaPrefs: Schema
	) { }

	// ログアウト時のライフサイクル管理
	public async handleLogout(accountId: string, enableBackup: boolean) {
		if (enableBackup) {
			const snapshot: BackupSnapshot = {
				_store: {},
				_prefs: {},
				_overrides: this.prefs._getOverrides(),
				// バックアップ対象：このアカウントが現在使っていたプロファイルのIDと、ユーザーがこの端末でカスタムしたプロファイルの実データ空間
				_activeProfileId: localDatabase.get('deviceAccount', accountId, '_active_profile_id'),
				_customProfiles: localDatabase.get('device', null, '_all_profiles'),
			};

			// 1. Storeからアカウント固有、かつバックアップ対象のデータを抽出
			for (const [key, def] of Object.entries(this.schemaStore)) {
				if (def.backup && def.layer === 'deviceAccount') {
					snapshot._store[key] = localDatabase.get('deviceAccount', accountId, key);
				}
			}

			// 2. Preferenceから現在アクティブなスコープに基づき、バックアップ対象を抽出
			for (const [key, def] of Object.entries(this.schemaPrefs)) {
				const activeLayer = snapshot._overrides[key] || def.layer;
				if (def.backup && (activeLayer === 'deviceAccount' || activeLayer === 'profile')) {
					snapshot._prefs[key] = this.prefs.r[key].value;
				}
			}

			// 3. サーバーの registry へエクスポート
			await misskeyApi('i/registry/set', {
				scope: ['client', 'backup', 'snapshot'],
				key: accountId,
				value: snapshot,
			});
		}

		// 当該アカウント固有のローカルストレージ（deviceAccount）を削除
		await localDatabase.deleteAccountStorage(accountId);

		// メモリ上のリセット
		this.store._loadValues({});
		this.prefs._loadOverrides({});
	}

	// ログイン（復旧）時のライフサイクル管理
	public async handleLogin(accountId: string) {
		try {
			// サーバーの registry からスナップショットをインポート
			const snapshot = await misskeyApi('i/registry/get', {
				scope: ['client', 'backup', 'snapshot'],
				key: accountId
			}) as BackupSnapshot | null;

			if (snapshot) {
				// 1. まずユーザー独自のスコープオーバーライド構成を復元
				if (snapshot._overrides) {
					this.prefs._loadOverrides(snapshot._overrides);
				}

				// 2. 状態（Store）をローカルストレージとメモリに復元
				if (snapshot._store) {
					this.store._loadValues(snapshot._store);
				}

				// 3. 設定値（Preference）を復元（動的解決ゲッターが自動的に正しいレイヤーに割り振る）
				if (snapshot._prefs) {
					for (const [key, value] of Object.entries(snapshot._prefs)) {
						this.prefs.r[key].value = value;
					}
				}
			}
		} catch (error) {
			console.error('Failed to restore client backup snapshot:', error);
		}
	}
}
