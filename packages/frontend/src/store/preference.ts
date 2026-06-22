/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, customRef, watch } from 'vue';
import { BroadcastChannel } from 'broadcast-channel';
import type { Ref } from 'vue';
import type { Schema, ExtractDefault, ReactiveState, StorageLayer, ManagerInterface, TabSyncMessage } from '@/store/types.js';
import { localDatabase } from '@/store/storage.js';

export class PreferencesManager<T, S extends Schema<T>> implements ManagerInterface<S> {
	public readonly s: ExtractDefault<S>;
	public readonly r: ReactiveState<S>;
	private channel: BroadcastChannel<TabSyncMessage>;
	private isEventReflecting = false;

	// 「どの設定項目がどのレイヤーにオーバーライドされているか」の動的マップ
	private scopeOverrides = ref<Record<string, StorageLayer>>({});

	constructor(
		private currentAccountId: Ref<string | null>,
		private currentProfileData: Ref<Record<string, any>>, // 現在選択中のプロファイルの実データ
		private schema: S,
	) {
		const sObj = {} as any;
		const rObj = {} as any;

		this.channel = new BroadcastChannel('misskey:pref-sync');

		for (const key of Object.keys(schema)) {
			rObj[key] = customRef((track, trigger) => {
				// アカウント、プロファイル、またはユーザーのスコープオーバーライドが変更されたらトリガー
				watch([currentAccountId, currentProfileData, this.scopeOverrides], () => { trigger(); }, { deep: true });

				// 他タブからの設定値、またはオーバーライド変更の同期受信
				this.channel.addEventListener('message', (msg) => {
					if (msg.type === 'value_changed' && msg.key === key) {
						const activeLayer = this.scopeOverrides.value[key] || this.schema[key].layer;
						if (activeLayer === 'deviceAccount' && msg.accountId !== this.currentAccountId.value) return;
						if (activeLayer === 'profile') return; // プロファイル層の同期はProfileManager側が担保

						this.isEventReflecting = true;
						trigger();
					}
					if (msg.type === 'scope_override_changed' && msg.key === key) {
						if (msg.accountId !== this.currentAccountId.value) return;
						this.scopeOverrides.value[key] = msg.layer;
						trigger();
					}
				});

				return {
					get: () => {
						track();
						const def = this.schema[key];
						// ユーザー設定があればそれ、なければデフォルトのレイヤーを採用（動的解決）
						const activeLayer = this.scopeOverrides.value[key] || def.layer;

						if (activeLayer === 'profile') {
							return this.currentProfileData.value[key] ?? def.default;
						}
						return localDatabase.get(activeLayer, this.currentAccountId.value, key) ?? def.default;
					},
					set: (newValue) => {
						const def = this.schema[key];
						const activeLayer = this.scopeOverrides.value[key] || def.layer;

						if (!this.isEventReflecting) {
							if (activeLayer === 'profile') {
								this.currentProfileData.value[key] = newValue;
							} else {
								localDatabase.set(activeLayer, this.currentAccountId.value, key, newValue);
								this.channel.postMessage({
									type: 'value_changed',
									key,
									value: newValue,
									accountId: this.currentAccountId.value
								});
							}
						}
						this.isEventReflecting = false;
						trigger();
					}
				};
			});

			Object.defineProperty(sObj, key, {
				get: () => rObj[key].value,
				enumerable: true,
			});
		}

		this.s = sObj;
		this.r = rObj;
	}

	public model<K extends keyof S>(key: K): Ref<S[K]['default']> {
		return this.r[key];
	}

	public set<K extends keyof S>(key: K, value: S[K]['default']) {
		this.r[key].value = value;
	}

	// ユーザーが項目単位でスコープを変更（オーバーライド）する
	public setScope<K extends keyof S>(key: K, newLayer: StorageLayer) {
		const propKey = key as string;
		if (!this.schema[propKey].allowedScopes?.includes(newLayer)) return;

		const currentValue = this.r[key].value;

		// 1. 新しい保存先へ現在のデータを移行
		if (newLayer === 'profile') {
			this.currentProfileData.value[propKey] = currentValue;
		} else {
			localDatabase.set(newLayer, this.currentAccountId.value, propKey, currentValue);
		}

		// 2. ランタイムのマッピングを書き換え
		this.scopeOverrides.value[propKey] = newLayer;

		// 3. 「どの項目をオーバーライドしたか」自体の構成をアカウント別ローカル領域に永続化
		localDatabase.set('deviceAccount', this.currentAccountId.value, `_scope_override_${propKey}`, newLayer);
	}

	public _loadOverrides(overrides: Record<string, StorageLayer>) {
		this.scopeOverrides.value = overrides;
	}

	public _getOverrides(): Record<string, StorageLayer> {
		return this.scopeOverrides.value;
	}
}
