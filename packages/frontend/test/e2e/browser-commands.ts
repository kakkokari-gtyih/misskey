/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { APIRequestContext, Page, Locator } from 'playwright';
import type { BrowserCommand } from 'vitest/node';
import '@vitest/browser-playwright';

const BASE_URL = 'http://localhost:61812';
const ADMIN_SETUP_PASSWORD = 'example_password_please_change_this_or_you_will_get_hacked';

interface RegisteredUser {
	id: string;
	token: string;
}

async function assertOk(status: number, body: string, route: string): Promise<void> {
	if (status >= 200 && status < 300) return;
	throw new Error(`${route} failed: status=${status} body=${body}`);
}

async function resetState(request: APIRequestContext): Promise<void> {
	const response = await request.post(`${BASE_URL}/api/reset-db`);
	await assertOk(response.status(), await response.text(), '/api/reset-db');
}

function locateMkInput(page: Page, testId: string): Locator {
	return page.locator(`[data-testid="${testId}"] input`);
}

function locateMkTextarea(page: Page, testId: string): Locator {
	return page.locator(`[data-testid="${testId}"] textarea`);
}

function locateMkSwitch(page: Page, testId: string): Locator {
	return page.locator(`[data-testid="${testId}"] [data-testid="switch-toggle"]`);
}

async function registerUser(
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
	await assertOk(response.status(), await response.text(), route);
	return await response.json() as RegisteredUser;
}

async function waitApiResponse(page: Page, path: string): Promise<void> {
	await page.waitForResponse((response) => {
		return response.url().endsWith(path) && response.request().method() === 'POST';
	}, { timeout: 30_000 });
}

async function visitHome(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/`);
	await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
}

async function signInFromTopPage(page: Page, username: string, password: string): Promise<void> {
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

async function dismissAccountSetupWizard(page: Page): Promise<void> {
	await page.locator('[data-testid="user-setup-dialog"] [data-testid="modal-window-close"]').click({ timeout: 30_000 });
	await page.getByTestId('modal-dialog-ok').click();
}

async function prepareAfterSetup(request: APIRequestContext): Promise<void> {
	await resetState(request);
	await registerUser(request, 'admin', 'pass', true);
}

async function prepareAfterSignup(page: Page, request: APIRequestContext): Promise<RegisteredUser> {
	await prepareAfterSetup(request);
	return await registerUser(request, 'alice', 'alice1234');
}

async function prepareAfterSignedIn(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterSignup(page, request);
	await visitHome(page);
	await signInFromTopPage(page, 'alice', 'alice1234');
}

async function prepareAfterUserSetup(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterSignedIn(page, request);
	await dismissAccountSetupWizard(page);
}

async function runBeforeSetupLoads(page: Page): Promise<void> {
	await visitHome(page);
}

async function runSetupInstance(page: Page): Promise<void> {
	await visitHome(page);

	await locateMkInput(page, 'admin-initial-password').fill(ADMIN_SETUP_PASSWORD);
	await locateMkInput(page, 'admin-username').fill('admin');
	await locateMkInput(page, 'admin-password').fill('admin1234');
	const signupResponse = waitApiResponse(page, '/api/admin/accounts/create');
	await page.getByTestId('admin-ok').click();
	await signupResponse;

	await page.getByTestId('next').click();
	await locateMkInput(page, 'server-setup-server-name').fill('Testskey');
	const updateMetaResponse = waitApiResponse(page, '/api/admin/update-meta');
	await page.getByTestId('server-setup-wizard-apply').click();
	await updateMetaResponse;
}

async function runAfterSetupLoads(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterSetup(request);
	await visitHome(page);
}

async function runSignup(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterSetup(request);
	await visitHome(page);

	await page.getByTestId('signup').click();
	await page.getByTestId('signup-rules-continue').waitFor({ state: 'visible' });
	if (!await page.getByTestId('signup-rules-continue').isDisabled()) {
		throw new Error('signup-rules-continue should be disabled before agreement');
	}
	await locateMkSwitch(page, 'signup-rules-notes-agree').click();
	await page.getByTestId('modal-dialog-ok').click();
	await page.getByTestId('signup-rules-continue').click();

	await locateMkInput(page, 'signup-username').fill('alice');
	await locateMkInput(page, 'signup-password').fill('alice1234');
	await locateMkInput(page, 'signup-password-retype').fill('alice1234');
	await locateMkInput(page, 'signup-invitation-code').fill('test-invitation-code');
	const signupResponse = waitApiResponse(page, '/api/signup');
	await page.getByTestId('signup-submit').click();
	await signupResponse;
}

async function runSignupDuplicated(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterSetup(request);
	await registerUser(request, 'alice', 'alice1234');
	await visitHome(page);

	await page.getByTestId('signup').click();
	await locateMkSwitch(page, 'signup-rules-notes-agree').click();
	await page.getByTestId('modal-dialog-ok').click();
	await page.getByTestId('signup-rules-continue').click();
	await locateMkInput(page, 'signup-username').fill('alice');
	await locateMkInput(page, 'signup-password').fill('alice1234');
	await locateMkInput(page, 'signup-password-retype').fill('alice1234');
	if (!await page.getByTestId('signup-submit').isDisabled()) {
		throw new Error('signup-submit should stay disabled for duplicated username');
	}
}

async function runSignIn(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterSignup(page, request);
	await visitHome(page);
	await signInFromTopPage(page, 'alice', 'alice1234');
}

async function runSuspend(page: Page, request: APIRequestContext): Promise<void> {
	await resetState(request);
	const admin = await registerUser(request, 'admin', 'pass', true);
	const alice = await registerUser(request, 'alice', 'alice1234');
	const suspendResponse = await request.post(`${BASE_URL}/api/admin/suspend-user`, {
		data: {
			i: admin.token,
			userId: alice.id,
		},
	});
	await assertOk(suspendResponse.status(), await suspendResponse.text(), '/api/admin/suspend-user');

	await visitHome(page);
	await page.getByTestId('signin').click();
	await page.getByTestId('signin-page-input').waitFor({ state: 'visible', timeout: 10_000 });
	await locateMkInput(page, 'signin-username').fill('alice');
	await page.keyboard.press('Enter');
	await page.getByText(/アカウントが凍結されています|This account has been suspended due to/).waitFor({ timeout: 10_000 });
}

async function runAfterSignedInLoads(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterSignedIn(page, request);
	await page.getByTestId('user-setup-continue').waitFor({ state: 'visible', timeout: 30_000 });
}

async function runAccountSetupWizard(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterSignedIn(page, request);
	await page.getByTestId('user-setup-continue').click({ timeout: 30_000 });
	await locateMkInput(page, 'user-setup-user-name').fill('ありす');
	await locateMkTextarea(page, 'user-setup-user-description').fill('ほげ');
	await page.getByTestId('user-setup-continue').click();
	await page.getByTestId('user-setup-continue').click();
	await page.getByTestId('user-setup-continue').click();
	await page.getByTestId('user-setup-continue').click();
	await page.getByTestId('user-setup-continue').click();
}

async function runCreateNote(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterUserSetup(page, request);
	await page.getByTestId('open-post-form').waitFor({ state: 'visible' });
	await page.getByTestId('open-post-form').click();
	await page.getByTestId('post-form-text').fill('Hello, Misskey!');
	await page.getByTestId('post-form-submit').click();
	await page.getByText('Hello, Misskey!').waitFor({ timeout: 15_000 });
}

async function runOpenNoteFormWithHotkey(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterUserSetup(page, request);
	await page.getByTestId('open-post-form').waitFor({ state: 'visible' });
	await page.keyboard.press('KeyN');
	await page.getByTestId('post-form-text').waitFor({ state: 'visible' });
	await page.keyboard.press('Escape');
	await page.getByTestId('post-form-text').waitFor({ state: 'hidden' });
}

async function runRedirectProfile(page: Page, request: APIRequestContext): Promise<void> {
	await prepareAfterUserSetup(page, request);
	await page.goto(`${BASE_URL}/redirect-test`);
	await page.waitForURL('**/@alice');
}

const scenarioHandlers = {
	'before-setup-loads': async (page: Page, _request: APIRequestContext) => runBeforeSetupLoads(page),
	'setup-instance': runSetupInstance,
	'after-setup-loads': runAfterSetupLoads,
	signup: runSignup,
	'signup-duplicated': runSignupDuplicated,
	signin: runSignIn,
	suspend: runSuspend,
	'after-signed-in-loads': runAfterSignedInLoads,
	'account-setup-wizard': runAccountSetupWizard,
	note: runCreateNote,
	'open-note-form-with-hotkey': runOpenNoteFormWithHotkey,
	'redirect-profile': runRedirectProfile,
} satisfies Record<string, (page: Page, request: APIRequestContext) => Promise<void>>;

export const runScenario: BrowserCommand<[scenario: string]> = async (ctx, scenario) => {
	if (ctx.provider.name !== 'playwright') {
		throw new Error(`playwright provider is required, but got ${ctx.provider.name}`);
	}

	if (!(scenario in scenarioHandlers)) {
		throw new Error(`unknown e2e scenario: ${scenario}`);
	}
	const run = scenarioHandlers[scenario as keyof typeof scenarioHandlers];

	const testPage = await ctx.context.newPage();
	await testPage.addInitScript(() => {
		(globalThis as { Cypress?: Record<string, unknown> }).Cypress = { browserMode: true };
	});

	try {
		await run(testPage, testPage.request);
	} finally {
		await testPage.close();
	}
};
