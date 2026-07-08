/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { commands } from 'vitest/browser';
import { describe, it } from 'vitest';

describe('Before setup instance', () => {
	it('successfully loads', async () => {
		await commands.runScenario('before-setup-loads');
	});

	it('setup instance', async () => {
		await commands.runScenario('setup-instance');
	});
});

describe('After setup instance', () => {
	it('successfully loads', async () => {
		await commands.runScenario('after-setup-loads');
	});

	it('signup', async () => {
		await commands.runScenario('signup');
	});

	it('signup with duplicated username', async () => {
		await commands.runScenario('signup-duplicated');
	});
});

describe('After user signup', () => {
	it('signin', async () => {
		await commands.runScenario('signin');
	});

	it('suspend', async () => {
		await commands.runScenario('suspend');
	});
});

describe('After user signed in', () => {
	it('successfully loads', async () => {
		await commands.runScenario('after-signed-in-loads');
	});

	it('account setup wizard', async () => {
		await commands.runScenario('account-setup-wizard');
	});
});

describe('After user setup', () => {
	it('note', async () => {
		await commands.runScenario('note');
	});

	it('open note form with hotkey', async () => {
		await commands.runScenario('open-note-form-with-hotkey');
	});
});
