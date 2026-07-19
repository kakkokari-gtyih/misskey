/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BroadcastChannel } from 'broadcast-channel';
import type { StorageProvider } from '@/preferences/manager.js';
import { cloudBackup } from '@/preferences/utility.js';
import { miLocalStorage } from '@/local-storage.js';
import { isSameScope, PreferencesManager } from '@/preferences/manager.js';
import { store } from '@/store.js';
import { $i } from '@/i.js';
import { preferencesTransport } from '@/preferences/transport.js';
import { TAB_ID } from '@/tab-id.js';

// クラウド同期用グループ名
const syncGroup = 'default';

const io: StorageProvider = {
	load: () => {
		const savedProfileRaw = miLocalStorage.getItem('preferences');
		if (savedProfileRaw == null) {
			return null;
		} else {
			return JSON.parse(savedProfileRaw);
		}
	},

	save: (ctx) => {
		miLocalStorage.setItem('preferences', JSON.stringify(ctx.profile));
	},

	cloudAvailability: () => preferencesTransport.getAvailability(),

	cloudGet: async (ctx) => {
		// 保存先は現在の操作アカウントではなくプライマリアカウント固定。詳細は @/preferences/transport.js
		try {
			const cloudData = await preferencesTransport.request('i/registry/get', {
				scope: ['client', 'preferences', 'sync'],
				key: syncGroup + ':' + ctx.key,
			}) as [any, any][];
			const target = cloudData.find(([scope]) => isSameScope(scope, ctx.scope));
			if (target == null) return null;
			return {
				value: target[1],
			};
		} catch (err: any) {
			if (err.code === 'NO_SUCH_KEY') { // TODO: いちいちエラーキャッチするのは面倒なのでキーが無くてもエラーにならない maybe-get のようなエンドポイントをバックエンドに実装する
				return null;
			} else {
				throw err;
			}
		}
	},

	cloudSet: async (ctx) => {
		let cloudData: [any, any][] = [];
		try {
			cloudData = await preferencesTransport.request('i/registry/get', {
				scope: ['client', 'preferences', 'sync'],
				key: syncGroup + ':' + ctx.key,
			}) as [any, any][];
		} catch (err: any) {
			if (err.code === 'NO_SUCH_KEY') { // TODO: いちいちエラーキャッチするのは面倒なのでキーが無くてもエラーにならない maybe-get のようなエンドポイントをバックエンドに実装する
				cloudData = [];
			} else {
				throw err;
			}
		}

		const i = cloudData.findIndex(([scope]) => isSameScope(scope, ctx.scope));

		if (i === -1) {
			cloudData.push([ctx.scope, ctx.value]);
		} else {
			cloudData[i] = [ctx.scope, ctx.value];
		}

		await preferencesTransport.request('i/registry/set', {
			scope: ['client', 'preferences', 'sync'],
			key: syncGroup + ':' + ctx.key,
			value: cloudData,
		});
	},

	cloudGetBulk: async (ctx) => {
		// 同期先が無い間は「1件も取得できなかった」として扱う。
		// ここで例外を投げると起動時のフェッチ(cloudReady)ごと倒れてしまうため。
		if (!await preferencesTransport.isAvailable()) return {};

		// TODO: 値の取得を1つのリクエストで済ませたい(バックエンド側でAPIの新設が必要)
		//
		// 取得はbest-effort。1件でも落とすと（例: tokenが失効していて全件401になり、
		// 1件目で輸送層が一時停止して残りが即座に失敗する）cloudReadyごと倒れてしまうので、
		// 失敗したキーは「取得できなかった」= ローカルの値を維持、として個別に握り潰す。
		const fetchings = ctx.needs.map(need => io.cloudGet(need).then(
			res => [need.key, res] as const,
			(err) => {
				if (_DEV_) console.warn('prefer:cloudGet failed', need.key, err);
				return [need.key, null] as const;
			},
		));
		const cloudDatas = await Promise.all(fetchings);

		const res = {} as Partial<Record<string, any>>;
		for (const cloudData of cloudDatas) {
			if (cloudData[1] != null) {
				res[cloudData[0]] = cloudData[1].value;
			}
		}

		return res;
	},
};

export const prefer = new PreferencesManager(io, $i);

//#region タブ間同期
let latestPreferencesUpdate: {
	tabId: string;
	timestamp: number;
} | null = null;

const preferencesChannel = new BroadcastChannel<{
	type: 'preferencesUpdate';
	tabId: string;
	timestamp: number;
}>('preferences');

prefer.on('committed', () => {
	latestPreferencesUpdate = {
		tabId: TAB_ID,
		timestamp: Date.now(),
	};
	preferencesChannel.postMessage({
		type: 'preferencesUpdate',
		tabId: TAB_ID,
		timestamp: latestPreferencesUpdate.timestamp,
	});
});

preferencesChannel.addEventListener('message', (msg) => {
	if (msg.type === 'preferencesUpdate') {
		if (msg.tabId === TAB_ID) return;
		if (latestPreferencesUpdate != null) {
			if (msg.timestamp <= latestPreferencesUpdate.timestamp) return;
		}
		prefer.reloadProfile();
		if (_DEV_) console.log('prefer:received update from other tab');
		latestPreferencesUpdate = {
			tabId: msg.tabId,
			timestamp: msg.timestamp,
		};
	}
});
//#endregion

//#region 定期クラウドバックアップ
let latestBackupAt = 0;

window.setInterval(() => {
	// 現在の操作アカウントの有無は問わない。バックアップ先はプライマリアカウントに固定されており、
	// 保存先が有るかどうかの判断は輸送層(@/preferences/transport.js)が持っている
	if (!store.s.enablePreferencesAutoCloudBackup) return;
	if (window.document.visibilityState !== 'visible') return; // 同期されていない古い値がバックアップされるのを防ぐ
	if (prefer.profile.modifiedAt <= latestBackupAt) return;

	cloudBackup().then(() => {
		latestBackupAt = Date.now();
	}, (err) => {
		// 同期先が無い / 一時停止中 / 一時的な失敗。次の周期で再試行するのでここでは通知しない
		// (定期処理なので、失敗のたびにダイアログを出すと極めてうるさくなる)
		if (_DEV_) console.warn('prefer:auto cloud backup failed', err);
	});
}, 1000 * 60 * 3);
//#endregion

if (_DEV_) {
	(window as any).prefer = prefer;
	(window as any).cloudBackup = cloudBackup;
}
