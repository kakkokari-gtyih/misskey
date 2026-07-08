/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

declare module 'vitest/browser' {
	interface BrowserCommands {
		runScenario: (scenario: string) => Promise<void>;
	}
}

export {};
