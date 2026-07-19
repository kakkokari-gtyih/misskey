/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 旧称 PIZZAX 時代の import パス互換のためのre-export。
// 実体は @/lib/state-store.js に移動済み。新規コードはそちらを直接importすること。

export { StateStore, StateStore as Pizzax } from '@/lib/state-store.js';
export type { StateDef } from '@/lib/state-store.js';
