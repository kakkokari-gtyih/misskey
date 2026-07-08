/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Locator, Page, APIRequestContext } from 'playwright';

export const BASE_URL = 'http://localhost:61812';
export const ADMIN_SETUP_PASSWORD = 'example_password_please_change_this_or_you_will_get_hacked';

export interface RegisteredUser {
	id: string;
	token: string;
}

//#region Misc
export function assertOk(status: number, body: string, route: string): void {
	if (status < 200 || status >= 300) {
		throw new Error(`${route} failed: status=${status} body=${body}`);
	}
}

export async function resetState(request: APIRequestContext): Promise<void> {
	const response = await request.post(`${BASE_URL}/api/reset-db`, {
		data: '{}',
		headers: {
			'Content-Type': 'application/json',
		},
	});
	assertOk(response.status(), await response.text(), '/api/reset-db');
}

export async function registerUser(
	request: APIRequestContext,
	username: string,
	password: string,
	isAdmin = false,
): Promise<RegisteredUser> {
	const route = isAdmin ? '/api/admin/accounts/create' : '/api/signup';
	const response = await request.post(`${BASE_URL}${route}`, {
		data: {
			username,
			password,
			...(isAdmin ? { setupPassword: ADMIN_SETUP_PASSWORD } : {}),
		},
	});
	assertOk(response.status(), await response.text(), route);
	return await response.json() as RegisteredUser;
}

export async function waitApiResponse(page: Page, path: string): Promise<void> {
	await page.waitForResponse((response) => {
		return response.url().endsWith(path) && response.request().method() === 'POST';
	}, { timeout: 30_000 });
}

export async function signIn(page: Page, username: string, password: string): Promise<void> {
	await page.getByTestId('signin').click();
	await page.getByTestId('signin-page-input').waitFor({ state: 'visible', timeout: 10_000 });
	await locateMkInput(page, 'signin-username').fill(username);
	await page.keyboard.press('Enter');
	await page.getByTestId('signin-page-password').waitFor({ state: 'visible', timeout: 10_000 });
	await locateMkInput(page, 'signin-password').fill(password);
	const signinResponse = waitApiResponse(page, '/api/signin-flow');
	await page.keyboard.press('Enter');
	await signinResponse;
}
//#endregion

//#region Locator Helpers
export function locateMkInput(page: Page, testId: string): Locator {
	return page.locator(`[data-testid="${testId}"] input`);
}

export function locateMkTextarea(page: Page, testId: string): Locator {
	return page.locator(`[data-testid="${testId}"] textarea`);
}

export function locateMkSwitch(page: Page, testId: string): Locator {
	return page.locator(`[data-testid="${testId}"] [data-testid="switch-toggle"]`);
}
//#endregion

//#region Page Helpers
export async function visitHome(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/`);
	await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
}
//#endregion
