/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { promises as fsp } from 'node:fs';
import { resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { I18n, normalizeLanguage } from 'i18n';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { Config } from '@/config.js';
import type { BackendLocale } from '@/i18n/autogen/locale.js';

/**
 * サーバー向けの翻訳 (/locales-backend) を提供する
 *
 * 全言語をメモリに載せ続けないよう、必要になった言語だけをその都度ファイルから読み込み、キャッシュしない。
 * 戻り値の I18n インスタンスは呼び出し側のスコープ内でのみ使い、フィールドなどに保持しないこと。
 * なお、翻訳データを import / require で読み込むとモジュールキャッシュに残り続ける (rolldown ではバンドルに埋め込まれる) ため使わないこと
 */
@Injectable()
export class ServerI18nService {
	private readonly localesDir: string;

	constructor(
		@Inject(DI.config)
		config: Config,
	) {
		this.localesDir = resolve(config.rootDir, 'built/_backend_locales_');
	}

	/**
	 * @param lang 言語タグ (ユーザーのプロフィールの言語設定など)。翻訳がない言語や未指定の場合は近い言語か en-US になる
	 */
	@bindThis
	public async get(lang: string | null | undefined): Promise<I18n<BackendLocale>> {
		const language = normalizeLanguage(lang);
		const json = await fsp.readFile(resolve(this.localesDir, `${language}.json`), 'utf-8');
		return new I18n<BackendLocale>(JSON.parse(json) as BackendLocale, process.env.NODE_ENV === 'development');
	}
}
