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
import { packedSigninSchema } from '@/models/schema/signin.js';
import { packedAdSchema } from '@/models/schema/ad.js';
import {
	packedEmojiSimpleSchema,
	packedEmojiDetailedSchema,
	packedEmojiDetailedAdminSchema,
} from '@/models/schema/emoji.js';
import { packedSystemWebhookSchema } from '@/models/schema/system-webhook.js';
import { packedFederationInstanceSchema } from '@/models/schema/federation-instance.js';
import { packedAppSchema } from '@/models/schema/app.js';
import { packedAntennaSchema } from '@/models/schema/antenna.js';
import { packedUserWebhookSchema } from '@/models/schema/user-webhook.js';
import { packedHashtagSchema } from '@/models/schema/hashtag.js';
import { packedAnnouncementSchema } from '@/models/schema/announcement.js';
import { packedUserListSchema } from '@/models/schema/user-list.js';

export const valibotRefs = {
	Signin: packedSigninSchema,
	Ad: packedAdSchema,
	EmojiSimple: packedEmojiSimpleSchema,
	EmojiDetailed: packedEmojiDetailedSchema,
	EmojiDetailedAdmin: packedEmojiDetailedAdminSchema,
	SystemWebhook: packedSystemWebhookSchema,
	FederationInstance: packedFederationInstanceSchema,
	App: packedAppSchema,
	Antenna: packedAntennaSchema,
	UserWebhook: packedUserWebhookSchema,
	Hashtag: packedHashtagSchema,
	Announcement: packedAnnouncementSchema,
	UserList: packedUserListSchema,
} as const;
