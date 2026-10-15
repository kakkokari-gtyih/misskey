/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import path from 'node:path';
import { languages } from 'i18n';
import { localesDir } from '../../frontend-shared/locales.js';
import type { Plugin } from 'vite';

/**
 * 外部ファイルを監視し、必要に応じてwebSocketでメッセージを送るViteプラグイン
 */
export default function pluginWatchLocales(): Plugin {
	return {
		name: 'watch-locales',

		configureServer(server) {
			const localeYmlPaths = languages.map(locale => path.join(localesDir, `${locale}.yml`));

			// watcherにパスを追加
			server.watcher.add(localeYmlPaths);

			server.watcher.on('change', (filePath) => {
				if (localeYmlPaths.includes(filePath)) {
					server.ws.send({
						type: 'custom',
						event: 'locale-update',
						data: filePath.match(/([^\/]+)\.yml$/)?.[1] || null,
					})
				}
			});
		},
	};
}
