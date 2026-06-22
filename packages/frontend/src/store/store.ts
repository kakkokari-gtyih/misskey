/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { customRef, watch } from 'vue';
import { BroadcastChannel } from 'broadcast-channel';
import type { Ref } from 'vue';
import type { Schema, ExtractDefault, ReactiveState, ManagerInterface, TabSyncMessage } from '@/store/types.js';
import { localDatabase } from '@/store/storage.js';

export class StoreManager<T, S extends Schema<T>> implements ManagerInterface<S> {
	public readonly s: ExtractDefault<S>;
	public readonly r: ReactiveState<S>;
	private channel: BroadcastChannel<TabSyncMessage>;
	private isEventReflecting = false;

	constructor(
		private currentAccountId: Ref<string | null>,
		private schema: S,
	) {
		const sObj = {} as any;
		const rObj = {} as any;

		this.channel = new BroadcastChannel('misskey:store-sync');

		for (const key of Object.keys(schema)) {
			// customRef を使用して、内部ストレージと完全に同期したRefを生成
			rObj[key] = customRef((track, trigger) => {
				// アカウントが切り替わった際に自動的に値を再評価・通知する
				watch(currentAccountId, () => { trigger(); });

				// 他のタブから状態変更を受け取った場合の処理
				this.channel.addEventListener('message', (msg) => {
					if (msg.type === 'value_changed' && msg.key === key) {
						// deviceAccountの場合は、同じアカウントをアクティブにしているタブ間のみ同期
						if (this.schema[key].layer === 'deviceAccount' && msg.accountId !== this.currentAccountId.value) return;

						this.isEventReflecting = true;
						trigger();
					}
				});

				return {
					get: () => {
						track();
						const def = this.schema[key];
						// 端末共通（device）か、アカウント固有（deviceAccount）かで自動分岐
						return localDatabase.get(def.layer, this.currentAccountId.value, key) ?? (typeof def.default === 'function' ? def.default() : def.default);
					},
					set: (newValue) => {
						const def = this.schema[key];
						// 他タブからの変更イベントの反映でなければ、ストレージ保存と他タブへのブロードキャストを行う
						if (!this.isEventReflecting) {
							localDatabase.set(def.layer, this.currentAccountId.value, key, newValue);
							this.channel.postMessage({
								type: 'value_changed',
								key,
								value: newValue,
								accountId: this.currentAccountId.value
							});
						}
						this.isEventReflecting = false;
						trigger();
					}
				};
			});

			// store.s.xxx で直接ゲッター経由で最新の値を覗けるようにする
			Object.defineProperty(sObj, key, {
				get: () => rObj[key].value,
				enumerable: true,
			});
		}

		this.s = sObj;
		this.r = rObj;
	}

	// v-model バインディング用のラッパー
	public model<K extends keyof S>(key: K): Ref<S[K]['default']> {
		return this.r[key];
	}

	public set<K extends keyof S>(key: K, value: S[K]['default']) {
		this.r[key].value = value;
	}

	// バックアップ復旧時などに外部から値を一流しする内部メソッド
	public _loadValues(data: Record<string, any>) {
		for (const [key, value] of Object.entries(data)) {
			if (key in this.schema) {
				localDatabase.set(this.schema[key].layer, this.currentAccountId.value, key, value);
				this.r[key].value = value;
			}
		}
	}
}
