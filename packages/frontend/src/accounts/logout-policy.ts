/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ログアウト時の分岐を決める純関数群。
 *
 * @/accounts/lifecycle.js から切り出してあるのは、あちらが config / os / accounts といった
 * 副作用の重いモジュールを静的importしており、判定規則だけを単体テストしたい場合に
 * それらを引きずり込んでしまうため。ここは型以外に何もimportしない。
 */

import type { LedgerEntry } from '@/accounts/ledger.js';

/**
 * 切替先になれるアカウントのtokenを選ぶ。
 * 現時点では外部ホストのアカウントへは切り替えられないので、ローカルホストに限る。
 */
export function pickNextAccountToken(entries: readonly LedgerEntry[], host: string): string | null {
	return entries.find(e => e.host === host && e.token != null)?.token ?? null;
}

/**
 * 単体ログアウトを全ログアウトへ昇格させるか？
 *
 * - 残りが0件 … そもそも維持すべきアカウントが無いのでワイプしてよい
 * - 対象が現在のアカウントで、切替先のtokenが無い … ログイン状態を維持できないので同上
 *   （外部ホストのアカウントしか残っていない場合など）
 * - 対象が現在のアカウントでない … 現在のセッションはそのまま続くので昇格しない
 */
export function shouldPromoteToFullLogout(opts: {
	/** 対象を取り除いた後に残るエントリ */
	remaining: readonly LedgerEntry[];
	/** 対象が現在ログイン中のアカウントか */
	isCurrentAccount: boolean;
	host: string;
}): boolean {
	if (opts.remaining.length === 0) return true;
	if (!opts.isCurrentAccount) return false;
	return pickNextAccountToken(opts.remaining, opts.host) == null;
}
