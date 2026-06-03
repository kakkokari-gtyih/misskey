import { defineConfig } from 'rolldown';
import { resolve } from 'path';
import { existsSync, promises as fsp } from 'fs';
import type { Plugin, ExternalOption } from 'rolldown';
import { execa, execaNode } from 'execa';
import type { ResultPromise } from 'execa';
import { externals } from 'nf3/plugin';
import { minifySync } from 'oxc-minify';
import esmShim from '@rollup/plugin-esm-shim';

/**
 * Watchモード時にバックエンドの起動・停止制御を行うプラグイン
 */
function backendDevServerPlugin(): Plugin {
	let backendProcess: ResultPromise | null = null;

	async function runBuildAssets() {
		await execa('pnpm', ['run', 'build-assets'], {
			cwd: '../../',
			stdout: process.stdout,
			stderr: process.stderr,
		});
	}

	async function killBackendProcess() {
		if (backendProcess) {
			backendProcess.catch(() => { }); // backendProcess.kill()によって発生する例外を無視するためにcatch()を呼び出す
			backendProcess.kill();
			await new Promise(resolve => backendProcess!.on('exit', resolve));
			backendProcess = null;
		}
	}

	return {
		name: 'backend-dev-server',
		async closeBundle() {
			await runBuildAssets();
			if (backendProcess) {
				await killBackendProcess();
			}
			backendProcess = execaNode('./built/entry.js', [], {
				stdout: process.stdout,
				stderr: process.stderr,
				env: {
					NODE_ENV: 'development',
				},
			});
		},
		async watchChange() {
			if (backendProcess) {
				await killBackendProcess();
				await runBuildAssets();
			}
		},
	};
}

function repackagePlugin(destDir: string): Plugin {
	return {
		name: 'repackage',
		// ビルド開始前に出力先ディレクトリをクリーンアップする
		async buildStart() {
			if (existsSync(destDir)) {
				await fsp.rm(destDir, { recursive: true, force: true });
			}
			await fsp.mkdir(destDir, { recursive: true });
		},
		// ビルド後に、生成されたファイルを出力先ディレクトリに移動する
		async closeBundle() {
			await fsp.cp('./built', resolve(destDir, './built'), { recursive: true });
			await fsp.cp('./assets', resolve(destDir, './assets'), { recursive: true });
			await fsp.cp('./scripts', resolve(destDir, './scripts'), { recursive: true });
			await fsp.cp('./migration', resolve(destDir, './migration'), { recursive: true });
			await fsp.cp('./nsfw-model', resolve(destDir, './nsfw-model'), { recursive: true });
		},
	};
}

export default defineConfig((args) => {
	const isWatchMode = args.watch != null && args.watch !== 'false';
	const isE2E = args.e2e != null && args.e2e !== 'false';

	const destinationDir = resolve(import.meta.dirname, '../../built/_backend_dist_');

	// 通常のビルド時にexternalとするモジュール
	const externalModules: ExternalOption = [
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
		'nsfwjs',
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
				(isWatchMode ? backendDevServerPlugin() : [
					repackagePlugin(destinationDir),
					externals({
						trace: {
							outDir: destinationDir,
							writePackageJson: false,
							// transform: [{
							// 	filter: (id) => /\.[mc]?js$/.test(id),
							// 	handler: (code, id) => minifySync(id, code, { compress: { keepNames: { function: true, class: true } } }).code,
							// }],
							hooks: {
								tracedPackages: async (packages) => {
									// package.jsonを作成
									const packageJson = JSON.parse(await fsp.readFile(resolve(import.meta.dirname, './package.json'), 'utf-8'));
									packageJson.dependencies = Object.fromEntries(Object.values(packages).map((pkg) => [pkg.name, Object.keys(pkg.versions)[0]]).sort((a, b) => a[0].localeCompare(b[0])));
									packageJson.devDependencies = undefined;
									packageJson.peerDependencies = undefined;
									packageJson.optionalDependencies = undefined;
									await fsp.writeFile(resolve(destinationDir, 'package.json'), JSON.stringify(packageJson, null, '\t'), 'utf-8');
								},
							},
						},
					}),
				]),
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
