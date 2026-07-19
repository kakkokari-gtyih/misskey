/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ログアウトの2導線。
 *
 * - `logoutAccount`     … このアカウントからログアウト（他アカウントは維持する）
 * - `logoutAllAccounts` … すべてのアカウントからログアウト（端末をワイプする）
 *
 * 「複数アカウントがある状態でログアウトすると全アカウントからログアウトされる」(#17066) は、
 * この2つを明確に分けたうえで、前者が **対象アカウントのキーだけを列挙して消す**
 * (@/accounts/erasure.js) ことによって解消される。
 */

import { apiUrl, host as localHost } from '@@/js/config.js';
import type { AccountKey } from '@/lib/storage/keys.js';
import { accountKeyOf } from '@/lib/storage/keys.js';
import { eraseAccountData, wipeDevice } from '@/accounts/erasure.js';
import { pickNextAccountToken, shouldPromoteToFullLogout } from '@/accounts/logout-policy.js';
import { keyOfEntry, listEntries, getEntry } from '@/accounts/ledger.js';
import { cloudBackup } from '@/preferences/utility.js';
import { login } from '@/accounts.js';
import { store } from '@/store.js';
import { waiting } from '@/os.js';
import { unisonReload } from '@/utility/unison-reload.js';
import { $i } from '@/i.js';

//#region プッシュ購読の解除

/**
 * このブラウザのプッシュ購読を、指定されたtokenの分だけサーバー側から解除する。
 *
 * **service worker自体はunregisterしない。** 単体ログアウトでは他のアカウントが
 * 引き続きservice workerを使うため。全ログアウト側で別途unregisterする。
 *
 * 失敗は握り潰す（サーバー側の購読が残るだけで、端末の消去は続行すべき）。
 */
async function unsubscribePush(tokens: readonly string[]): Promise<void> {
	if (tokens.length === 0) return;

	try {
		if (!navigator.serviceWorker.controller) return;

		const registration = await navigator.serviceWorker.ready;
		const push = await registration.pushManager.getSubscription();
		if (push == null) return;

		await Promise.all(tokens.map(token => window.fetch(`${apiUrl}/sw/unregister`, {
			method: 'POST',
			body: JSON.stringify({
				i: token,
				endpoint: push.endpoint,
			}),
			headers: {
				'Content-Type': 'application/json',
			},
		}).catch(() => { /* 個別の失敗で他のアカウントの解除を止めない */ })));
	} catch {
		// service workerが無い・未対応などはそのまま続行する
	}
}

async function unregisterServiceWorkers(): Promise<void> {
	try {
		const registrations = await navigator.serviceWorker.getRegistrations();
		await Promise.all(registrations.map(r => r.unregister()));
	} catch {
		// nothing
	}
}

//#endregion

async function backupIfEnabled(): Promise<void> {
	if (store.s.enablePreferencesAutoCloudBackup) {
		await cloudBackup();
	}
}

/**
 * このアカウントからログアウトする。
 *
 * アカウント一覧からの削除と、そのアカウントの設定値・状態の削除をまとめて行う。
 * **対象が現在のアカウントでなければリロードは起きない**（列挙ベース削除の成果）。
 *
 * @param account 省略時は現在ログイン中のアカウント
 */
export async function logoutAccount(account?: AccountKey): Promise<void> {
	const target = account ?? ($i != null ? accountKeyOf(localHost, $i.id) : null);
	if (target == null) return;

	const isCurrentAccount = $i != null && target === accountKeyOf(localHost, $i.id);
	const remaining = listEntries().filter(e => keyOfEntry(e) !== target);

	// 最後の1アカウントなら全ログアウトへ昇格する
	if (shouldPromoteToFullLogout({ remaining, isCurrentAccount, host: localHost })) {
		await logoutAllAccounts();
		return;
	}

	if (isCurrentAccount) waiting();

	await backupIfEnabled();

	// 当該アカウントのtokenでプッシュ購読を解除する。
	// $i.tokenは現在のアカウントの分しか無いので、台帳から引く。
	const token = getEntry(target)?.token;
	if (token != null) await unsubscribePush([token]);

	await eraseAccountData(target);

	if (!isCurrentAccount) {
		// 現在のセッションには影響しないのでリロード不要
		return;
	}

	// 現在のアカウントを消したので次のアカウントへ切り替える。
	// 遷移の挙動はlogin()内で行うのでunisonReloadは呼ばない。
	const nextToken = pickNextAccountToken(remaining, localHost);
	if (nextToken != null) {
		await login(nextToken, undefined, false);
		return;
	}

	// shouldPromoteToFullLogoutで弾かれているはずだが、保険
	await logoutAllAccounts();
}

/**
 * すべてのアカウントからログアウトする（ブラウザから利用者情報を削除する）。
 *
 * ただし`persistent`分類の状態（ヒントの既読・言語・テーマ等）は残す。詳細は
 * @/accounts/erasure.js の `wipeDevice` を参照。
 */
export async function logoutAllAccounts(): Promise<void> {
	waiting();

	await backupIfEnabled();

	const tokens = listEntries().map(e => e.token).filter((t): t is string => t != null);
	await unsubscribePush(tokens);
	await unregisterServiceWorkers();

	await wipeDevice();

	unisonReload('/');
}
