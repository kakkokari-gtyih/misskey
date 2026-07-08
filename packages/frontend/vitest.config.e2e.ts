import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { runScenario } from './test/e2e/browser-commands.js';
import { getConfig } from './vite.config.js';

export default mergeConfig(getConfig(), defineConfig({
	test: {
		include: ['./test/e2e/**/*.test.ts'],
		exclude: [],
		setupFiles: ['./test/setup.e2e.ts'],
		fileParallelism: false,
		maxWorkers: 1,
		testTimeout: 60000,
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			screenshotFailures: true,
			screenshotDirectory: './test/e2e/screenshots',
			commands: {
				runScenario,
			},
			instances: [{
				browser: 'chromium',
			}],
		},
	},
}));
