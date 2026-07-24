/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AV_LOG_ERROR, Log } from 'node-av';

/*
 * libav 自体のログ出力を抑制する。
 *
 * 既定の AV_LOG_INFO のままだと blackframe のようなフィルタが 1 フレームごとに
 * stderr へ 1 行吐くため、動画 1 本の解析で数百行のノイズになる。
 * Misskey 側の診断は各サービスの Logger で行うので、libav からはエラーのみ受け取る。
 *
 * プロセス全体に効く設定なので、node-av を使うモジュールから副作用 import する。
 */
Log.setLevel(AV_LOG_ERROR);
