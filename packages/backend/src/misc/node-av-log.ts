/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AV_LOG_ERROR, Log } from 'node-av';

// libav 自体のログ出力を抑制する
// node-av を使うモジュールから副作用 import する必要がある
Log.setLevel(AV_LOG_ERROR);
