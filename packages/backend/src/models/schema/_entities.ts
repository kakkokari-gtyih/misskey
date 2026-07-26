/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Valibot 版 packed スキーマのレジストリ。
 *
 * legacy の [refs](../../misc/json-schema.ts) と対になるもので、`Packed<'X'>` の条件型が
 * 「Valibot 化済みか」を判定するための **型レベルの索引** として使う
 * (`x extends keyof typeof valibotRefs ? v.InferOutput<...> : SchemaType<...>`)。
 *
 * entity を 1 つ移行するたびに、ここへ追記し legacy `refs` から同名エントリを削除する。
 * ランタイムの `$ref` 復元は {@link ../../misc/schema/registry.ts} の `defineEntity()` が
 * 担うので、このオブジェクトはランタイムでは参照されない。
 *
 * 全 entity の移行が完了したら (PR-F) `Packed<>` ごと削除し、各 `Packed*` 型の直接 import へ移る。
 */
export const valibotRefs = {} as const;
