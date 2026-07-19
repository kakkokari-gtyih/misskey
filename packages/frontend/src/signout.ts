/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { logoutAccount, logoutAllAccounts } from '@/accounts/lifecycle.js';

/**
 * アカウントからログアウトし、そのアカウントに関するデータを削除します。
 *
 * 実体は @/accounts/lifecycle.js の2導線。既存の呼び出し箇所との互換のために
 * この薄いラッパを残してある。
 *
 * @param all すべてのアカウントからログアウトするか？
 */
export async function signout(all = false): Promise<void> {
	return all ? logoutAllAccounts() : logoutAccount();
}
