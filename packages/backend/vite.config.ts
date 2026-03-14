/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from 'path';
import { promises as fsp } from 'fs';
import { defineConfig } from 'vite';
import { externals } from 'nf3/plugin';
import { minifySync } from 'oxc-minify';
import esmShim from '@rollup/plugin-esm-shim';

const outDir = resolve(import.meta.dirname, 'built');
const rootPackageJsonPath = resolve(import.meta.dirname, '../../package.json');
const commonJsInteropPattern = /(?:^|\W)(?:module\.exports\b|exports\.|Object\.defineProperty\(exports,\s*["'`]__esModule["'`]|require\()/;

export default defineConfig({
	plugins: [
		esmShim(),
		externals({
			traceInclude: [
				'@nestjs/*',
			],
			trace: {
				outDir,
				writePackageJson: false,
				transform: [{
					filter: (id) => /\.[mc]?js$/.test(id),
					handler: async (code, id) => {
						// CommonJS interopコードはコード的に等価でも形式が違うと動かなくなるため、minifyせずにそのまま出力する
						if (commonJsInteropPattern.test(code)) {
							return code;
						}

						const minified = minifySync(id, code, {
							module: true,
						});
						return minified.code;
					},
				}],
				hooks: {
					tracedPackages: async (packages) => {
						const rootPackageJson = JSON.parse(await fsp.readFile(rootPackageJsonPath, 'utf-8'));

						// build package.json for built files
						const packageJson = {
							name: 'misskey-backend',
							type: 'module',
							private: true,
							version: rootPackageJson.version,
							scripts: {
								start: 'node ./entry.js',
								cli: 'node ./cli.js',
								migrate: 'node ./migrate.js',
							},
							dependencies: Object.fromEntries(Object.values(packages).map(pkg => [pkg.name, Object.keys(pkg.versions)[0]])),
						};

						await fsp.writeFile(resolve(outDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8');
					},
				},
			},
		}),
	],
	build: {
		ssr: true,
		sourcemap: true,
		// minify: 'oxc',
		minify: false,
		outDir,
		rolldownOptions: {
			tsconfig: true,
			input: [
				'./src/boot/entry.ts',
				'./src/boot/cli.ts',
				'./src/config.ts',
				'./src/postgres.ts',
				'./src/server/api/openapi/gen-spec.ts',
			],
			output: {
				keepNames: true,
				cleanDir: true,
				format: 'esm',
			},
		},
	},
});
