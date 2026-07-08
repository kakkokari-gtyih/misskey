/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { commands } from 'vitest/browser';
import { describe, it } from 'vitest';

describe('Router transition', () => {
	describe('Redirect', () => {
		it('redirect to user profile', async () => {
			await commands.runScenario('redirect-profile');
		});
	});
});
