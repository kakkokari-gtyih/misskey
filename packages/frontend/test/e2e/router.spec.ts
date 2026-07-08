/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { test } from './fixtures.js';
import {
	// const
	BASE_URL,
	// utils
	resetState, registerUser,
	// page utils
	signIn,
} from './utils.js';

test.describe('Router transition', () => {
	test.beforeAll(async ({ page, request }) => {
		await resetState(request);
		await registerUser(request, 'admin', 'pass', true);
		await registerUser(request, 'alice', 'alice1234');
		await signIn(page, 'alice', 'alice1234');

		// 表示に時間がかかるのでデフォルト秒数だとタイムアウトする
		await page.locator('[data-testid="user-setup-dialog"] [data-testid="modal-window-close"]').click({ timeout: 30000 });
		await page.getByTestId('modal-dialog-ok').click();
	});

	test.describe('Redirect', () => {
		test('redirect to user profile', async ({ page }) => {
			await page.goto(`${BASE_URL}/redirect-test`);
			await page.waitForURL('**/@alice');
		});
	});
});
