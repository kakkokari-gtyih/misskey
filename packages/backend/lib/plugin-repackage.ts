import { existsSync, promises as fsp } from 'fs';
import { resolve } from 'path';
import type { Plugin } from 'rolldown';
import { traceNodeModules } from 'nf3';
import { builtinModules } from 'module';
import { minifySync } from 'oxc-minify';
import { ResolverFactory } from 'oxc-resolver';

export function repackagePlugin(destDir: string, forceCopyDeps: string[] = []): Plugin {
	const esmResolver = new ResolverFactory({
		conditionNames: ['node', 'import'],
	});
	const cjsResolver = esmResolver.cloneWithOptions({
		conditionNames: ['node', 'require'],
	});

	return {
		name: 'repackage',
		// ビルド開始前に出力先ディレクトリをクリーンアップする
		async buildStart() {
			if (existsSync(destDir)) {
				await fsp.rm(destDir, { recursive: true, force: true });
			}
			await fsp.mkdir(destDir, { recursive: true });
		},
		async writeBundle(_, bundle) {
			const externalModules = new Set<string>();

			function resolveEntryPath(id: string, importer: string, force = false) {
				if (!force && (id.startsWith('\0') || builtinModules.includes(id) || id.startsWith('node:'))) {
					return null;
				}

				const esmResult = esmResolver.resolveFileSync(importer, id);
				if (esmResult) {
					return esmResult.path;
				}

				const cjsResult = cjsResolver.resolveFileSync(importer, id);
				if (cjsResult) {
					return cjsResult.path;
				}

				return null;
			}

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
				const resolvedPath = resolveEntryPath(dep, resolve(import.meta.dirname, '../built/entry.js'), true);

				if (resolvedPath) {
					externalModules.add(resolvedPath);
				}
			}

			await traceNodeModules(Array.from(externalModules), {
				outDir: destDir,
				writePackageJson: false,
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
			await fsp.cp('./built', resolve(destDir, './built'), { recursive: true });
			await fsp.cp('./assets', resolve(destDir, './assets'), { recursive: true });
			await fsp.cp('./scripts', resolve(destDir, './scripts'), { recursive: true });
			await fsp.cp('./migration', resolve(destDir, './migration'), { recursive: true });
			await fsp.cp('./nsfw-model', resolve(destDir, './nsfw-model'), { recursive: true });
		},
	};
}
