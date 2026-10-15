/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { writeFile } from 'node:fs/promises';
import { loadFrontendLocales } from '../../frontend-shared/locales.js';

await writeFile(
	new URL('locale.ts', import.meta.url),
	`export default ${JSON.stringify(loadFrontendLocales()['ja-JP'], undefined, 2)} as const;`,
	'utf8',
)
