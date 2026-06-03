import { existsSync, promises as fsp } from 'fs';
import { resolve } from 'path';
import type { Plugin } from 'rolldown';
import { traceNodeModules } from 'nf3';
import type { ExternalsTraceOptions } from 'nf3';
import { builtinModules } from 'module';
import { minifySync } from 'oxc-minify';
import { ResolverFactory } from 'oxc-resolver';

type ForceCopyDeps = NonNullable<ExternalsTraceOptions['fullTraceInclude']>;

/**
 * 本番環境用のビルドで、外部化した依存関係を出力先ディレクトリにコピーするプラグイン
 */
export function repackagePlugin(destDir: string, forceCopyDeps: ForceCopyDeps = []): Plugin {
	const esmResolver = new ResolverFactory({
		conditionNames: ['node', 'import'],
		extensions: ['.js', '.mjs', '.json', '.node'],
	});
	const cjsResolver = esmResolver.cloneWithOptions({
		conditionNames: ['node', 'require'],
		extensions: ['.js', '.cjs', '.json', '.node'],
	});

	function resolveEntryPath(id: string, importer: string, force = false) {
		if (!force && (id.startsWith('\0') || builtinModules.includes(id) || id.startsWith('node:'))) {
			return null;
		}

		const esmResult = esmResolver.sync(importer, id);
		if (esmResult) {
			return esmResult.path ?? null;
		}

		const cjsResult = cjsResolver.sync(importer, id);
		if (cjsResult) {
			return cjsResult.path ?? null;
		}

		return null;
	}

	return {
		name: 'repackage',
		// ビルド開始前に出力先ディレクトリをクリーンアップする
		async buildStart() {
			this.info(`Cleaning up destination directory: ${destDir}`);
			if (existsSync(destDir)) {
				await fsp.rm(destDir, { recursive: true, force: true });
			}
			await fsp.mkdir(destDir, { recursive: true });
		},
		// バンドル構成確定後に、外部化した依存関係をトレースして出力先ディレクトリにコピーする
		async writeBundle(_, bundle) {
			this.info('Tracing external dependencies...');

			const externalModules = new Set<string>();

			for (const chunk of Object.values(bundle)) {
				if (chunk.type === 'chunk') {
					const importer = resolve(import.meta.dirname, `../built/${chunk.fileName}`);

					for (const id of chunk.imports) {
						const resolvedPath = resolveEntryPath(id, importer);

						if (resolvedPath) {
							externalModules.add(resolvedPath);
						}
					}
					for (const id of chunk.dynamicImports) {
						const resolvedPath = resolveEntryPath(id, importer);

						if (resolvedPath) {
							externalModules.add(resolvedPath);
						}
					}
				}
			}

			for (const dep of forceCopyDeps) {
				const depName = typeof dep === 'string' ? dep : dep[0];
				const resolvedPath = resolveEntryPath(depName, resolve(import.meta.dirname, '../built/entry.js'), true);

				if (resolvedPath) {
					externalModules.add(resolvedPath);
				} else if (existsSync(resolve(import.meta.dirname, `../node_modules/${depName}/package.json`))) {
					// 直接解決できない場合、node_modules 内に存在するかを確認して追加
					this.warn(`[WARN] Failed to resolve "${depName}" directly, but it exists in node_modules. Adding it to trace list.`);
					externalModules.add(resolve(import.meta.dirname, `../node_modules/${depName}/package.json`));
				}
			}

			await traceNodeModules(Array.from(externalModules), {
				outDir: destDir,
				writePackageJson: false,
				fullTraceInclude: forceCopyDeps,
				transform: [{
					filter: (id) => /\.[mc]?js$/.test(id),
					handler: (code, id) => minifySync(id, code, { compress: { keepNames: { function: true, class: true } } }).code,
				}],
				hooks: {
					tracedPackages: async (packages) => {
						// package.jsonを作成
						const packageJson = JSON.parse(await fsp.readFile(resolve(import.meta.dirname, '../package.json'), 'utf-8'));
						packageJson.dependencies = Object.fromEntries(Object.values(packages).map((pkg) => [pkg.name, Object.keys(pkg.versions)[0]]).sort((a, b) => a[0].localeCompare(b[0])));
						packageJson.devDependencies = undefined;
						packageJson.peerDependencies = undefined;
						packageJson.optionalDependencies = undefined;
						await fsp.writeFile(resolve(destDir, 'package.json'), JSON.stringify(packageJson, null, '\t'), 'utf-8');
					},
				},
			});
		},
		// ビルド後に、生成されたファイルを出力先ディレクトリに移動する
		async closeBundle() {
			this.info('Copying built files to destination directory...');
			await fsp.cp(resolve(import.meta.dirname, './built'), resolve(destDir, './built'), { recursive: true });
			await fsp.cp(resolve(import.meta.dirname, './assets'), resolve(destDir, './assets'), { recursive: true });
			await fsp.cp(resolve(import.meta.dirname, './scripts'), resolve(destDir, './scripts'), { recursive: true });
			await fsp.cp(resolve(import.meta.dirname, './migration'), resolve(destDir, './migration'), { recursive: true });
			await fsp.cp(resolve(import.meta.dirname, './nsfw-model'), resolve(destDir, './nsfw-model'), { recursive: true });
			await fsp.cp(resolve(import.meta.dirname, './ormconfig.js'), resolve(destDir, './ormconfig.js'), { recursive: true });
		},
	};
}
