/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineAsyncComponent, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { apiUrl, host } from '@@/js/config.js';
import type { MenuItem } from '@/types/menu.js';
import { showSuspendedDialog } from '@/utility/show-suspended-dialog.js';
import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';
import { waiting, popup, popupMenu, success, alert } from '@/os.js';
import { unisonReload, reloadChannel } from '@/utility/unison-reload.js';
import { prefer } from '@/preferences.js';
import { $i } from '@/i.js';
import { signout } from '@/signout.js';
import { accountKeyOf } from '@/lib/storage/keys.js';
import { getEntry, ledgerReady, listEntries, upsertEntry } from '@/accounts/ledger.js';
import { eraseAccountData } from '@/accounts/erasure.js';

type AccountWithToken = Misskey.entities.MeDetailed & { token: string };

export type AccountData = {
	host: string;
	id: Misskey.entities.User['id'];
	username: Misskey.entities.User['username'];
	user?: Misskey.entities.MeDetailed | null;
	token: string | null;
};

/** ロースター(`prefer.s.accounts`)からusernameを引く。台帳側にusernameが無い場合の補完用 */
function rosterUsernameOf(host: string, id: string): string | null {
	return prefer.s.accounts.find(x => x[0] === host && x[1].id === id)?.[1].username ?? null;
}

/**
 * 真実の源は資格情報台帳(@/accounts/ledger.js)。
 * `prefer.s.accounts` はtokenを持たない可搬性ロースターとして残っているので、
 * 台帳に載っていないアカウント（設定のプロファイルを復元した直後など）はそちらから補う。
 */
export async function getAccounts(): Promise<AccountData[]> {
	await ledgerReady;

	const accounts: AccountData[] = listEntries().map(entry => ({
		host: entry.host,
		id: entry.id,
		username: entry.username || rosterUsernameOf(entry.host, entry.id) || entry.id,
		user: entry.user,
		token: entry.token,
	}));

	for (const [host, user] of prefer.s.accounts) {
		if (accounts.some(x => x.host === host && x.id === user.id)) continue;
		accounts.push({
			host,
			id: user.id,
			username: user.username,
			user: null,
			token: null,
		});
	}

	return accounts;
}

/** ログイン等で得たtokenを台帳に記録する。既存のusername・ユーザー情報は失わない */
async function recordToken(host: string, id: string, token: string) {
	const existing = getEntry(accountKeyOf(host, id));
	await upsertEntry({
		host,
		id,
		username: existing?.username ?? rosterUsernameOf(host, id) ?? '',
		token,
		user: existing?.user ?? null,
	});
}

async function addAccount(host: string, user: Misskey.entities.MeDetailed, token: AccountWithToken['token']) {
	await upsertEntry({
		host,
		id: user.id,
		username: user.username,
		token,
		user,
	});

	if (!prefer.s.accounts.some(x => x[0] === host && x[1].id === user.id)) {
		prefer.commit('accounts', [...prefer.s.accounts, [host, { id: user.id, username: user.username }]]);
	}
}

/**
 * アカウントを端末から取り除く。
 *
 * 台帳・ロースターからの除去だけでなく、そのアカウントに紐づく状態・キャッシュも
 * キー空間の列挙によってまとめて消す(@/accounts/erasure.js)。
 * 「台帳からは消えたが `mk::state::acct:*::*` が残る」という消し漏れを構造的に防ぐため、
 * 消去はこの1経路に集約してある。
 */
export async function removeAccount(host: string, id: AccountWithToken['id']) {
	await eraseAccountData(accountKeyOf(host, id));
}

/**
 * @deprecated `removeAccount()` が消去まで行うようになったため不要。
 * 呼び出し箇所の互換のために残してある（冪等なので二重に呼んでも安全）。
 */
export async function removeAccountAssociatedData(host: string, id: AccountWithToken['id']) {
	await eraseAccountData(accountKeyOf(host, id));
}

const isAccountDeleted = Symbol('isAccountDeleted');

function fetchAccount(token: string, id?: string, forceShowDialog?: boolean): Promise<Misskey.entities.MeDetailed> {
	return new Promise((done, fail) => {
		window.fetch(`${apiUrl}/i`, {
			method: 'POST',
			body: JSON.stringify({
				i: token,
			}),
			headers: {
				'Content-Type': 'application/json',
			},
		})
			.then(res => new Promise<Misskey.entities.MeDetailed | { error: Record<string, any> }>((done2, fail2) => {
				if (res.status >= 500 && res.status < 600) {
					// サーバーエラー(5xx)の場合をrejectとする
					// （認証エラーなど4xxはresolve）
					return fail2(res);
				}
				res.json().then(done2, fail2);
			}))
			.then(async res => {
				if ('error' in res) {
					if (res.error.id === 'a8c724b3-6e9c-4b46-b1a8-bc3ed6258370') {
						// SUSPENDED
						if (forceShowDialog || $i && (token === $i.token || id === $i.id)) {
							await showSuspendedDialog();
						}
					} else if (res.error.id === 'e5b3b9f0-2b8f-4b9f-9c1f-8c5c1b2e1b1a') {
						// USER_IS_DELETED
						// アカウントが削除されている
						if (forceShowDialog || $i && (token === $i.token || id === $i.id)) {
							await alert({
								type: 'error',
								title: i18n.ts.accountDeleted,
								text: i18n.ts.accountDeletedDescription,
							});
						}
					} else if (res.error.id === 'b0a7f5f8-dc2f-4171-b91f-de88ad238e14') {
						// AUTHENTICATION_FAILED
						// トークンが無効化されていたりアカウントが削除されたりしている
						if (forceShowDialog || $i && (token === $i.token || id === $i.id)) {
							await alert({
								type: 'error',
								title: i18n.ts.tokenRevoked,
								text: i18n.ts.tokenRevokedDescription,
							});
						}
					} else {
						await alert({
							type: 'error',
							title: i18n.ts.failedToFetchAccountInformation,
							text: JSON.stringify(res.error),
						});
					}

					fail(isAccountDeleted);
				} else {
					done(res);
				}
			})
			.catch(fail);
	});
}

export function updateCurrentAccount(accountData: Misskey.entities.MeDetailed) {
	if (!$i) return;
	const token = $i.token;
	for (const key of Object.keys($i)) {
		delete $i[key as keyof typeof $i];
	}
	for (const [key, value] of Object.entries(accountData)) {
		($i[key as keyof typeof accountData] as any) = value;
	}
	void upsertEntry({ host, id: $i.id, username: $i.username, token, user: { ...$i } });
	$i.token = token;
	miLocalStorage.setItem('account', JSON.stringify($i));
}

export function updateCurrentAccountPartial(accountData: Partial<Misskey.entities.MeDetailed>) {
	if (!$i) return;
	for (const [key, value] of Object.entries(accountData)) {
		($i[key as keyof typeof accountData] as any) = value;
	}

	void upsertEntry({ host, id: $i.id, username: $i.username, token: $i.token, user: { ...$i } });

	miLocalStorage.setItem('account', JSON.stringify($i));
}

export async function refreshCurrentAccount() {
	if (!$i) return;
	const me = $i;
	return fetchAccount($i.token, $i.id).then(updateCurrentAccount).catch(reason => {
		if (reason === isAccountDeleted) {
			removeAccount(host, me.id);
			const fallback = listEntries().find(x => x.token != null);
			if (fallback?.token != null) {
				login(fallback.token);
			} else {
				signout();
			}
		}
	});
}

export async function refreshAccounts() {
	const accounts = await getAccounts();
	for (const account of accounts) {
		if (account.host === host && account.id === $i?.id) {
			await refreshCurrentAccount();
		} else if (account.token) {
			try {
				const user = await fetchAccount(account.token, account.id);
				await upsertEntry({
					host: account.host,
					id: account.id,
					username: user.username,
					token: account.token,
					user,
				});
			} catch (e) {
				if (e === isAccountDeleted) {
					// removeAccountが関連データの消去まで行うので、別途の消去呼び出しは不要
					await removeAccount(account.host, account.id);
				}
			}
		}
	}
}

export async function login(token: AccountWithToken['token'], redirect?: string, showWaiting = true) {
	const showing = ref(true);

	if (showWaiting) {
		const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkWaitingDialog.vue')), {
			success: false,
			showing: showing,
		}, {
			closed: () => dispose(),
		});
	}

	const me = await fetchAccount(token, undefined, true).catch(reason => {
		showing.value = false;
		throw reason;
	});

	miLocalStorage.setItem('account', JSON.stringify({
		...me,
		token,
	}));

	await addAccount(host, me, token);

	if (redirect) {
		// 他のタブは再読み込みするだけ
		reloadChannel.postMessage(null);
		// このページはredirectで指定された先に移動
		window.location.href = redirect;
		return;
	}

	unisonReload();
}

export async function switchAccount(host: string, id: string) {
	await ledgerReady;
	const token = getEntry(accountKeyOf(host, id))?.token;
	if (token) {
		login(token);
	} else {
		const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkSigninDialog.vue')), {}, {
			done: async (res: Misskey.entities.SigninFlowResponse & { finished: true }) => {
				await recordToken(host, res.id, res.i);
				login(res.i);
			},
			closed: () => {
				dispose();
			},
		});
	}
}

export async function getAccountMenu(opts: {
	includeCurrentAccount?: boolean;
	withExtraOperation: boolean;
	active?: Misskey.entities.User['id'];
	onChoose?: (account: Misskey.entities.MeDetailed) => void;
}) {
	if ($i == null) throw new Error('No current account');
	const me = $i;

	const callback = opts.onChoose;

	function createItem(host: string, id: Misskey.entities.User['id'], username: Misskey.entities.User['username'], account: Misskey.entities.MeDetailed | null | undefined, token: string | null): MenuItem {
		if (account) {
			return {
				type: 'user' as const,
				user: account,
				active: opts.active != null ? opts.active === id : false,
				action: async () => {
					if (callback) {
						callback(account);
					} else {
						switchAccount(host, id);
					}
				},
			};
		} else if (token != null) {
			return {
				type: 'button' as const,
				text: username,
				active: opts.active != null ? opts.active === id : false,
				action: async () => {
					if (callback) {
						fetchAccount(token, id).then(account => {
							callback(account);
						});
					} else {
						switchAccount(host, id);
					}
				},
			};
		} else { // プロファイルを復元した場合などはアカウントのトークンや詳細情報はstoreにキャッシュされていない
			return {
				type: 'button' as const,
				text: username,
				active: opts.active != null ? opts.active === id : false,
				action: async () => {
					const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkSigninDialog.vue')), {
						initialUsername: username,
					}, {
						done: async (res: Misskey.entities.SigninFlowResponse & { finished: true }) => {
							await recordToken(host, res.id, res.i);

							if (callback) {
								fetchAccount(res.i, id).then(account => {
									callback(account);
								});
							} else {
								switchAccount(host, id);
							}
						},
						closed: () => {
							dispose();
						},
					});
				},
			};
		}
	}

	const menuItems: MenuItem[] = [];

	// TODO: $iのホストも比較したいけど通常null
	const accountItems = (await getAccounts().then(accounts => accounts.filter(x => x.id !== me.id))).map(a => createItem(a.host, a.id, a.username, a.user, a.token));

	if (opts.withExtraOperation) {
		menuItems.push({
			type: 'link',
			text: i18n.ts.profile,
			to: `/@${$i.username}`,
			avatar: $i,
		}, {
			type: 'divider',
		});

		if (opts.includeCurrentAccount) {
			menuItems.push(createItem(host, $i.id, $i.username, $i, $i.token));
		}

		menuItems.push(...accountItems);

		menuItems.push({
			type: 'parent',
			icon: 'ti ti-plus',
			text: i18n.ts.addAccount,
			children: [{
				text: i18n.ts.existingAccount,
				action: () => {
					getAccountWithSigninDialog().then(res => {
						if (res != null) {
							success();
						}
					});
				},
			}, {
				text: i18n.ts.createAccount,
				action: () => {
					getAccountWithSignupDialog().then(res => {
						if (res != null) {
							switchAccount(host, res.id);
						}
					});
				},
			}],
		}, {
			type: 'link',
			icon: 'ti ti-users',
			text: i18n.ts.manageAccounts,
			to: '/settings/accounts',
		});
	} else {
		if (opts.includeCurrentAccount) {
			menuItems.push(createItem(host, $i.id, $i.username, $i, $i.token));
		}

		menuItems.push(...accountItems);
	}

	return menuItems;
}

export function getAccountWithSigninDialog(): Promise<{ id: string, token: string } | null> {
	return new Promise((resolve) => {
		const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkSigninDialog.vue')), {}, {
			done: async (res: Misskey.entities.SigninFlowResponse & { finished: true }) => {
				const user = await fetchAccount(res.i, res.id, true);
				await addAccount(host, user, res.i);
				resolve({ id: res.id, token: res.i });
			},
			cancelled: () => {
				resolve(null);
			},
			closed: () => {
				dispose();
			},
		});
	});
}

export function getAccountWithSignupDialog(): Promise<{ id: string, token: string } | null> {
	return new Promise((resolve) => {
		const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkSignupDialog.vue')), {}, {
			done: async (res: Misskey.entities.SignupResponse) => {
				const user = JSON.parse(JSON.stringify(res));
				delete user.token;
				await addAccount(host, user, res.token);
				resolve({ id: res.id, token: res.token });
			},
			cancelled: () => {
				resolve(null);
			},
			closed: () => {
				dispose();
			},
		});
	});
}
