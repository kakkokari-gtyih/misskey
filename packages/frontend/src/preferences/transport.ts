/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 設定のクラウド同期・バックアップの輸送層。
 *
 * 設定プロファイルは「デバイスの持ち物」だが、その同期とバックアップの置き場だけは
 * サーバー側のregistryを借りている。従来はこれを **現在ログイン中のアカウント** の
 * registryに読み書きしていたため、アカウントを切り替えると保存先ごと変わってしまい、
 * 「どのアカウントに設定が入っているのか」が利用者にも実装にも曖昧だった。
 *
 * ここではregistryを「プロファイルの所有者」ではなく
 *   (1) 項目同期のトランスポート
 *   (2) バックアップ置き場
 * という2つのサービスとして扱い直し、その接続先を **プライマリアカウント**
 * (@/accounts/ledger.js) に固定する。以降、操作アカウントを切り替えても保存先は動かない。
 *
 * ## プライマリが無いときにフォールバックしない理由
 *
 * 「プライマリ未設定 / tokenを持たない」場合は現在のアカウントへフォールバックせず、
 * 同期・バックアップを行わない。フォールバックすると結局アカウントによって保存先が
 * 変わることになり、この改修が解こうとしている問題がそのまま再発するため。
 *
 * ただし「同期先が無い」と「クラウドにその値が無い」は意味が全く違う（前者で値が無いと
 * 誤認すると、ローカルの値をクラウドの空で上書きしかねない）。そこで前者は
 * null等の正常値ではなく {@link PreferencesTransportUnavailableError} として送出し、
 * 呼び出し側が必ず区別できるようにしている。
 */

import { ref } from 'vue';
import type { Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { getEntry, getPrimaryAccountKey, ledgerReady } from '@/accounts/ledger.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/**
 * - `noPrimaryAccount` … プライマリが未設定、もしくはそのアカウントがtokenを持たない
 * - `suspended`        … プライマリのtokenが無効化されていたため一時停止した
 */
export type TransportUnavailableReason = 'noPrimaryAccount' | 'suspended';

export type TransportAvailability = {
	available: true;
} | {
	available: false;
	reason: TransportUnavailableReason;
};

/** 「同期先が無い」ことを表す。値が無いこと(null)と混同されないよう例外にしてある */
export class PreferencesTransportUnavailableError extends Error {
	public readonly reason: TransportUnavailableReason;

	constructor(reason: TransportUnavailableReason) {
		super(`preferences transport is unavailable: ${reason}`);
		this.name = 'PreferencesTransportUnavailableError';
		this.reason = reason;
	}
}

export function isTransportUnavailable(err: unknown): err is PreferencesTransportUnavailableError {
	return err instanceof PreferencesTransportUnavailableError;
}

/** @see packages/backend/src/server/api/ApiCallService.ts */
const AUTHENTICATION_FAILED_ID = 'b0a7f5f8-dc2f-4171-b91f-de88ad238e14';

/**
 * tokenが失効している系のエラーかどうか。
 * ネットワーク断や一時的なサーバーエラーで同期を止めてしまわないよう、
 * 「そのtokenでは今後も通らない」と言い切れるものだけを対象にする。
 */
export function isAuthenticationFailure(err: unknown): boolean {
	if (typeof err !== 'object' || err == null) return false;
	const e = err as { id?: unknown; code?: unknown };
	return e.id === AUTHENTICATION_FAILED_ID
		|| e.code === 'AUTHENTICATION_FAILED'
		|| e.code === 'CREDENTIAL_REQUIRED';
}

export type PreferencesTransportDeps = {
	/**
	 * 台帳のロード完了。
	 *
	 * `prefer`はモジュール初期化時点でクラウドの値を取りに行く(`PreferencesManager`の
	 * コンストラクタが`fetchCloudValues()`を走らせる)ため、台帳のロードを待たずに
	 * プライマリを引くと「未設定」に見えてしまい、同期が黙って無効化される。
	 * 輸送層の入口で必ずこれを待つことで、呼び出し側がタイミングを意識しなくて済む。
	 */
	ready: Promise<void>;
	getPrimaryToken: () => string | null;
	api: (endpoint: string, data: Record<string, any>, token: string) => Promise<any>;
	/** 一時停止に入った瞬間に1度だけ呼ばれる(利用者への通知用) */
	onSuspend?: () => void;
};

export class PreferencesTransport {
	/** tokenが失効していたため一時停止中かどうか。UIの状態表示に使う */
	public readonly suspended: Ref<boolean> = ref(false);

	/** どのtokenで弾かれたのか。復帰判定に使う */
	private suspendedToken: string | null = null;

	private deps: PreferencesTransportDeps;

	constructor(deps: PreferencesTransportDeps) {
		this.deps = deps;
	}

	/**
	 * 一時停止はセッション限りで、永続化しない。
	 * 永続化すると「再ログインしたのに同期が戻らない」状態から利用者が抜け出しにくくなるため。
	 */
	private suspend(token: string): void {
		if (this.suspended.value) return;
		this.suspendedToken = token;
		this.suspended.value = true;
		this.deps.onSuspend?.();
	}

	public resume(): void {
		this.suspended.value = false;
		this.suspendedToken = null;
	}

	/**
	 * 一時停止は「そのtokenでは通らない」という事実に紐づく。保存先を選び直したり
	 * ログインし直してtokenが変わったら、その事実はもう当てはまらないので自動で解除する。
	 *
	 * こうしておくと「プライマリを変えたら復帰させる」責務を呼び出し側に配らずに済む
	 * （＝ 呼び忘れで同期が止まったままになる経路を作らない）。
	 */
	private refreshSuspension(token: string | null): void {
		if (!this.suspended.value) return;
		if (token !== this.suspendedToken) this.resume();
	}

	public async getAvailability(): Promise<TransportAvailability> {
		await this.deps.ready;

		const token = this.deps.getPrimaryToken();
		this.refreshSuspension(token);

		if (this.suspended.value) return { available: false, reason: 'suspended' };
		if (token == null) return { available: false, reason: 'noPrimaryAccount' };
		return { available: true };
	}

	public async isAvailable(): Promise<boolean> {
		return (await this.getAvailability()).available;
	}

	/**
	 * プライマリアカウントのtokenでAPIを叩く。
	 *
	 * @throws {PreferencesTransportUnavailableError} 同期先が無い / 一時停止中のとき
	 */
	public async request<
		ResT = void,
		E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
		P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
		_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
	>(endpoint: E, data: P): Promise<_ResT> {
		await this.deps.ready;

		const token = this.deps.getPrimaryToken();
		this.refreshSuspension(token);

		if (this.suspended.value) throw new PreferencesTransportUnavailableError('suspended');
		if (token == null) throw new PreferencesTransportUnavailableError('noPrimaryAccount');

		try {
			return await this.deps.api(endpoint, data as Record<string, any>, token) as _ResT;
		} catch (err) {
			if (isAuthenticationFailure(err)) {
				this.suspend(token);
				throw new PreferencesTransportUnavailableError('suspended');
			}
			throw err;
		}
	}
}

//#region シングルトン（アプリ本体が使う入口）

/**
 * 一時停止の通知。セッション中1回きりで、かつ`os`/`i18n`は動的importする。
 *
 * 静的importにすると `manager → transport → os → preferences → manager` の
 * 循環がモジュール初期化時に成立してしまうため。
 * (@/accounts/ledger.js がストレージ実体を遅延解決しているのと同じ理屈)
 */
async function notifySuspended(): Promise<void> {
	try {
		const [os, { i18n }] = await Promise.all([
			import('@/os.js'),
			import('@/i18n.js'),
		]);
		os.alert({
			type: 'warning',
			title: i18n.ts._primaryAccount.suspendedTitle,
			text: i18n.ts._primaryAccount.suspendedDescription,
		});
	} catch (err) {
		console.error('failed to notify the preferences sync suspension', err);
	}
}

export const preferencesTransport = new PreferencesTransport({
	ready: ledgerReady,
	getPrimaryToken: () => {
		const key = getPrimaryAccountKey();
		if (key == null) return null;
		return getEntry(key)?.token ?? null;
	},
	api: (endpoint, data, token) => misskeyApi(endpoint as keyof Misskey.Endpoints, data, token),
	onSuspend: () => { notifySuspended(); },
});

//#endregion
