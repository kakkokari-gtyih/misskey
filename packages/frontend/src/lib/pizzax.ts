/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PIZZAX --- A lightweight store

// TODO: Misskeyのドメイン知識があるのでutilityなどに移動する

import { customRef, ref, watch, onScopeDispose } from 'vue';
import { BroadcastChannel } from 'broadcast-channel';
import { host as selfHost } from '@@/js/config.js';
import type { Ref } from 'vue';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { get, set, delMany } from '@/utility/idb-proxy.js';
import { buildKey, accountKeyOf } from '@/lib/storage/keys.js';
import { migrateLegacyKeys } from '@/lib/storage/migrate.js';
import { store } from '@/store.js';
import { deepClone } from '@/utility/clone.js';
import { deepMerge } from '@/utility/merge.js';

type StateDef = Record<string, {
	where: 'account' | 'device' | 'deviceAccount';
	default: any;
}>;

type State<T extends StateDef> = { [K in keyof T]: T[K]['default']; };
type ReactiveState<T extends StateDef> = { [K in keyof T]: Ref<T[K]['default']>; };

type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

type PizzaxChannelMessage<T extends StateDef> = {
	where: 'device' | 'deviceAccount';
	key: keyof T;
	value: T[keyof T]['default'];
	userId?: string;
};

export class Pizzax<T extends StateDef> {
	public readonly ready: Promise<void>;
	public readonly loaded: Promise<void>;

	public readonly key: string;
	public readonly deviceStateKeyName: string;
	public readonly deviceAccountStateKeyName: string;
	public readonly registryCacheKeyName: string;

	public readonly def: T;

	// TODO: これが実装されたらreadonlyにしたい: https://github.com/microsoft/TypeScript/issues/37487
	/**
	 * static / state の略 (static が予約語のため)
	 */
	public readonly s: State<T>;

	/**
	 * reactive の略
	 */
	public readonly r: ReactiveState<T>;

	private pizzaxChannel: BroadcastChannel<PizzaxChannelMessage<T>>;

	// 簡易的にキューイングして占有ロックとする
	private currentIdbJob: Promise<unknown> = Promise.resolve();
	private addIdbSetJob<T>(job: () => Promise<T>) {
		const promise = this.currentIdbJob.then(job, err => {
			console.error('Pizzax failed to save data to idb!', err);
			return job();
		});
		this.currentIdbJob = promise;
		return promise;
	}

	constructor(key: string, def: T) {
		this.key = key;
		this.deviceStateKeyName = buildKey({ category: 'state', owner: { kind: 'device' }, name: key });
		this.deviceAccountStateKeyName = $i ? Pizzax.buildDeviceAccountStateKeyName(key, selfHost, $i.id) : '';
		this.registryCacheKeyName = $i ? Pizzax.buildRegistryCacheKeyName(key, selfHost, $i.id) : '';
		this.def = def;

		this.pizzaxChannel = new BroadcastChannel(`pizzax::${key}`);

		this.s = {} as State<T>;
		this.r = {} as ReactiveState<T>;

		for (const [k, v] of Object.entries(def) as [keyof T, T[keyof T]['default']][]) {
			// 参照渡しになるのを防ぐためclone
			const defaultValue = deepClone(v.default);
			this.s[k] = defaultValue;
			this.r[k] = ref(defaultValue);
		}

		this.ready = this.init();
		this.loaded = this.ready.then(() => this.load());
	}

	private isPureObject(value: unknown): value is Record<string | number | symbol, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	private mergeState<X>(value: X, def: X): X {
		if (this.isPureObject(value) && this.isPureObject(def)) {
			const merged = deepMerge<Record<PropertyKey, unknown>>(value, def);

			if (_DEV_) console.log('Merging state. Incoming: ', value, ' Default: ', def, ' Result: ', merged);

			return merged as X;
		}
		return value;
	}

	private static buildDeviceAccountStateKeyName(key: string, host: string, userId: string): string {
		return buildKey({ category: 'state', owner: { kind: 'account', account: accountKeyOf(host, userId) }, name: key });
	}

	private static buildRegistryCacheKeyName(key: string, host: string, userId: string): string {
		return buildKey({ category: 'cache', owner: { kind: 'account', account: accountKeyOf(host, userId) }, name: `registry-${key}` });
	}

	private async init(): Promise<void> {
		// 超旧バージョンからの直行アップグレードに備え、localStorage => idb を先に通してから
		// 旧pizzaxキー => 新mkキー空間の移行を行う（移行チェーンの順序を崩さないこと）
		await this.migrate();
		await migrateLegacyKeys();
		await this.adoptOwnLegacyKeys();

		const deviceState: State<T> = await get(this.deviceStateKeyName) || {};
		const deviceAccountState = $i ? await get(this.deviceAccountStateKeyName) || {} : {};
		const registryCache = $i ? await get(this.registryCacheKeyName) || {} : {};

		for (const [k, v] of Object.entries(this.def) as [keyof T, T[keyof T]['default']][]) {
			if (v.where === 'device' && Object.prototype.hasOwnProperty.call(deviceState, k)) {
				this.r[k].value = this.s[k] = this.mergeState<T[keyof T]['default']>(deviceState[k], v.default);
			} else if (v.where === 'account' && $i && Object.prototype.hasOwnProperty.call(registryCache, k)) {
				this.r[k].value = this.s[k] = this.mergeState<T[keyof T]['default']>(registryCache[k], v.default);
			} else if (v.where === 'deviceAccount' && Object.prototype.hasOwnProperty.call(deviceAccountState, k)) {
				this.r[k].value = this.s[k] = this.mergeState<T[keyof T]['default']>(deviceAccountState[k], v.default);
			} else {
				// 参照渡しになるのを防ぐためclone
				this.r[k].value = this.s[k] = deepClone(v.default);
			}
		}

		this.pizzaxChannel.addEventListener('message', ({ where, key, value, userId }) => {
			// アカウント変更すればunisonReloadが効くため、このreturnが発火することは
			// まずないと思うけど一応弾いておく
			if (where === 'deviceAccount' && !($i && userId !== $i.id)) return;
			this.r[key].value = this.s[key] = value;
		});
	}

	private load(): Promise<void> {
		return new Promise((resolve, reject) => {
			if ($i) {
				// api関数と循環参照なので一応setTimeoutしておく
				window.setTimeout(async () => {
					await store.ready;

					misskeyApi('i/registry/get-all', { scope: ['client', this.key] })
						.then(kvs => {
							const cache: Partial<T> = {};
							for (const [k, v] of Object.entries(this.def) as [keyof T, T[keyof T]['default']][]) {
								if (v.where === 'account') {
									if (Object.prototype.hasOwnProperty.call(kvs, k)) {
										this.r[k].value = this.s[k] = (kvs as Partial<T>)[k];
										cache[k] = (kvs as Partial<T>)[k];
									} else {
										// 参照渡しになるのを防ぐためclone
										this.r[k].value = this.s[k] = deepClone(v.default);
									}
								}
							}

							return set(this.registryCacheKeyName, cache);
						})
						.then(() => resolve());
				}, 1);
			} else {
				resolve();
			}
		});
	}

	public set<K extends keyof T>(key: K, value: T[K]['default']): Promise<void> {
		// IndexedDBやBroadcastChannelで扱うために単純なオブジェクトにする
		// (JSON.parse(JSON.stringify(value))の代わり)
		const rawValue = deepClone(value);

		this.r[key].value = this.s[key] = rawValue;

		return this.addIdbSetJob(async () => {
			switch (this.def[key].where) {
				case 'device': {
					this.pizzaxChannel.postMessage({
						where: 'device',
						key,
						value: rawValue,
					});
					const deviceState = await get(this.deviceStateKeyName) || {};
					deviceState[key] = rawValue;
					await set(this.deviceStateKeyName, deviceState);
					break;
				}
				case 'deviceAccount': {
					if ($i == null) break;
					this.pizzaxChannel.postMessage({
						where: 'deviceAccount',
						key,
						value: rawValue,
						userId: $i.id,
					});
					const deviceAccountState = await get(this.deviceAccountStateKeyName) || {};
					deviceAccountState[key] = rawValue;
					await set(this.deviceAccountStateKeyName, deviceAccountState);
					break;
				}
				case 'account': {
					if ($i == null) break;
					const cache = await get(this.registryCacheKeyName) || {};
					cache[key] = rawValue;
					await set(this.registryCacheKeyName, cache);
					await misskeyApi('i/registry/set', {
						scope: ['client', this.key],
						key: key.toString(),
						value: rawValue,
					});
					break;
				}
			}
		});
	}

	public push<K extends keyof T>(key: K, value: ArrayElement<T[K]['default']>): void {
		const currentState = this.s[key];
		this.set(key, [...currentState, value]);
	}

	public reset(key: keyof T) {
		// 参照渡しになるのを防ぐためclone
		const defaultValue = deepClone(this.def[key].default);
		this.set(key, defaultValue);
		return defaultValue;
	}

	/** 指定アカウントに紐づくデータをデバイスから削除します */
	public async clearAccountDataFromDevice(id = $i?.id, host = selfHost) {
		if (id == null) return;

		const deviceAccountStateKey = Pizzax.buildDeviceAccountStateKeyName(this.key, host, id);
		const registryCacheKey = Pizzax.buildRegistryCacheKeyName(this.key, host, id);

		await this.addIdbSetJob(async () => {
			await delMany([deviceAccountStateKey, registryCacheKey]);
		});
	}

	/**
	 * 特定のキーの、簡易的なcomputed refを作ります
	 * 主にvue上で設定コントロールのmodelとして使う用
	 */
	public model<K extends keyof T, R = T[K]['default']>(
		key: K,
	): Ref<R>;
	public model<K extends keyof T, R extends Exclude<any, T[K]['default']>>(
		key: K,
		getter: (v: T[K]['default']) => R,
		setter: (v: R) => T[K]['default'],
	): Ref<R>;

	public model<K extends keyof T, R>(
		key: K,
		getter?: (v: T[K]['default']) => R,
		setter?: (v: R) => T[K]['default'],
	): Ref<R> {
		return customRef<R>((track, trigger) => {
			const watchStop = watch(this.r[key], () => {
				trigger();
			});

			onScopeDispose(() => {
				watchStop();
			}, true);

			return {
				get: () => {
					track();
					return (getter != null ? getter(this.s[key]) : this.s[key]) as R;
				},
				set: (value) => {
					const val = setter != null ? setter(value) : value;
					this.set(key, val as T[K]['default']);
				},
			};
		});
	}

	// localStorage => indexedDBのマイグレーション
	// 対象は旧文法(`pizzax::*`)のキーのまま。ここでidbへ載せたものを、後段のmigrateLegacyKeys()が
	// 新文法へ移す二段構えになっている
	private async migrate() {
		const { legacyDeviceStateKey, legacyDeviceAccountStateKey, legacyRegistryCacheKey } = this.legacyKeyNames();

		const deviceState = localStorage.getItem(legacyDeviceStateKey);
		if (deviceState) {
			await set(legacyDeviceStateKey, JSON.parse(deviceState));
			localStorage.removeItem(legacyDeviceStateKey);
		}

		const deviceAccountState = $i && localStorage.getItem(legacyDeviceAccountStateKey);
		if ($i && deviceAccountState) {
			await set(legacyDeviceAccountStateKey, JSON.parse(deviceAccountState));
			localStorage.removeItem(legacyDeviceAccountStateKey);
		}

		const registryCache = $i && localStorage.getItem(legacyRegistryCacheKey);
		if ($i && registryCache) {
			await set(legacyRegistryCacheKey, JSON.parse(registryCache));
			localStorage.removeItem(legacyRegistryCacheKey);
		}
	}

	private legacyKeyNames() {
		return {
			legacyDeviceStateKey: `pizzax::${this.key}`,
			legacyDeviceAccountStateKey: $i ? `pizzax::${this.key}::${$i.id}` : '',
			legacyRegistryCacheKey: $i ? `pizzax::${this.key}::cache::${$i.id}` : '',
		};
	}

	/**
	 * migrateLegacyKeys()はboot中に一度しか走らないので、それより後に生成されたインスタンスの
	 * migrate()が掘り起こした旧キーを取りこぼす。自分の分だけはここで拾い直す（copy-if-absent）。
	 */
	private async adoptOwnLegacyKeys(): Promise<void> {
		const { legacyDeviceStateKey, legacyDeviceAccountStateKey, legacyRegistryCacheKey } = this.legacyKeyNames();

		const pairs: [string, string][] = [[legacyDeviceStateKey, this.deviceStateKeyName]];
		if ($i) {
			pairs.push([legacyDeviceAccountStateKey, this.deviceAccountStateKeyName]);
			pairs.push([legacyRegistryCacheKey, this.registryCacheKeyName]);
		}

		for (const [from, to] of pairs) {
			if (await get(to) !== undefined) continue;
			const value = await get(from);
			if (value === undefined) continue;
			await set(to, value);
		}
	}
}
