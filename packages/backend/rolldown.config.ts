import { defineConfig } from 'rolldown';
import { resolve } from 'path';
import type { ExternalOption } from 'rolldown';

import { backendDevServerPlugin } from './lib/plugin-dev-server.js';
import { repackagePlugin } from './lib/plugin-repackage.js';
import esmShim from '@rollup/plugin-esm-shim';

export default defineConfig((args) => {
	const isWatchMode = args.watch != null && args.watch !== 'false';
	const isE2E = args.e2e != null && args.e2e !== 'false';

	const destinationDir = resolve(import.meta.dirname, '../../built/_backend_dist_');

	// 通常のビルド時にexternalとするモジュール
	const externalModules: ExternalOption = [
		'slacc',
		/^slacc-.*/,
		'class-transformer',
		'class-validator',
		/^@sentry\/.*/,
		/^@sentry-internal\/.*/,
		'@nestjs/websockets/socket-module',
		'@nestjs/microservices/microservices-module',
		'@nestjs/microservices',
		/^@napi-rs\/.*/,
		// @tensorflow/tfjs-node はネイティブバインディングを持つため external 必須 (#17501)。
		// あわせて nsfwjs と @tensorflow/* 全体を external にする。bundle 内の nsfwjs が
		// 抱える @tensorflow/tfjs-core と、external な tfjs-node が使う tfjs-core が
		// 別インスタンスに分裂すると、tfjs-node が登録する file:// IOHandler を nsfwjs 側が
		// 共有できず、モデル読み込みが HTTP handler(node-fetch) にフォールバックして
		// 「URL scheme "file" is not supported」で失敗するため。
		/^@tensorflow\/.*/,
		/^nsfwjs\/?.*/,
		'mock-aws-s3',
		'aws-sdk',
		'nock',
		'sharp',
		'jsdom',
		're2',
		'ipaddr.js',
		'file-type',
	];

	if (isE2E) {
		return {
			input: './test-server/entry.ts',
			platform: 'node',
			tsconfig: './test-server/tsconfig.json',
			plugins: [
				esmShim(),
			],
			output: {
				keepNames: true,
				sourcemap: true,
				dir: './built-test',
				cleanDir: true,
				format: 'esm',
			},
			external: externalModules,
		};
	} else {
		return {
			input: [
				'./src/boot/entry.ts',
				'./src/boot/cli.ts',
				'./src/config.ts',
				'./src/postgres.ts',
				'./src/server/api/openapi/gen-spec.ts',
			],
			platform: 'node',
			tsconfig: true,
			plugins: [
				esmShim(),
				(isWatchMode ? backendDevServerPlugin() : repackagePlugin(destinationDir, [
					'nsfwjs/core',
					['@misskey-dev/emoji-assets', { glob: 'built/**' }],
				])),
			],
			output: {
				keepNames: true,
				minify: !isWatchMode,
				sourcemap: isWatchMode,
				dir: './built',
				cleanDir: !isWatchMode,
				format: 'esm',
			},
			watch: {
				include: ['src/**/*.{ts,js,mjs,cjs,tsx,json}'],
				clearScreen: false,
			},
			// ビルドの高速化のために、watchモードのときは外部モジュールは全てバンドルしないようにする
			external: isWatchMode ? /^(?!@\/)[^.\/](?!:[\/\\])/ : externalModules,
		};
	}
});
