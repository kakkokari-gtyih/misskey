import tsParser from '@typescript-eslint/parser';
import sharedConfig from '../shared/eslint.config.js';

// eslint-disable-next-line import/no-default-export
export default [
	...sharedConfig,
	{
		ignores: [
			'**/node_modules',
			'built',
			'coverage',
			'vitest.config.ts',
			'test',
			'test-d',
			'generator',
			// TODO: Error while loading rule '@typescript-eslint/naming-convention': Cannot use 'in' operator to search for 'type' in undefined のため一時的に無効化
			// See https://github.com/misskey-dev/misskey/pull/15311
			'src/I18n.ts',
		],
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				project: ['./tsconfig.eslint.json'],
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['src/autogen/**/*.ts', 'src/autogen/**/*.tsx'],
		rules: {
			'@stylistic/indent': 'off',
		},
	},
];
