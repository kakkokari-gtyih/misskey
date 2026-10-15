// @ts-check

/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * クライアント向け言語ファイル (/locales) から以下を生成する
 * - 翻訳キーの型 (js/autogen/locale.d.ts)
 * - Service Worker などが HTTP 経由で取得する言語別 JSON (built/_frontend_dist_/locales)
 *
 * --watch: 言語ファイルとバージョンの変更を監視して再生成する
 * --verify: 生成は行わず、言語ファイルの整合性検査のみ行う
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLocaleInterface, verifyLocales } from 'i18n/build';
import { loadFrontendLocales, localesDir } from './locales.js';

const _dirname = path.dirname(fileURLToPath(import.meta.url));
const _rootPackageJsonPath = path.resolve(_dirname, '../../package.json');
const _frontendLocalesDir = path.resolve(_dirname, '../../built/_frontend_dist_/locales');
const _localeInterfaceFile = path.resolve(_dirname, 'js/autogen/locale.d.ts');

const args = process.argv.slice(2);

/** @param {string} message */
function log(message) {
	console.log(`[frontend-shared] ${message}`);
}

async function generateTypes() {
	await generateLocaleInterface({
		sourceFile: path.join(localesDir, 'ja-JP.yml'),
		outFile: _localeInterfaceFile,
		typeName: 'Locale',
		typesModule: 'i18n',
		generatedBy: 'packages/frontend-shared/build.js',
	});
	log('locale interface generated.');
}

async function writeLocalesJson() {
	const { version } = JSON.parse(await fs.promises.readFile(_rootPackageJsonPath, 'utf-8'));

	await fs.promises.mkdir(_frontendLocalesDir, { recursive: true });

	for (const [lang, locale] of Object.entries(loadFrontendLocales())) {
		await fs.promises.writeFile(
			path.join(_frontendLocalesDir, `${lang}.${version}.json`),
			JSON.stringify({ ...locale, '_version_': version }),
			'utf-8',
		);
	}
	log(`locales JSON written to ${_frontendLocalesDir}`);
}

function verify() {
	const errors = verifyLocales(loadFrontendLocales());

	for (const error of errors) {
		process.stderr.write(JSON.stringify(error));
		process.stderr.write('\n');
	}

	if (errors.length > 0) {
		process.exit(1);
	}
	log('locales verified.');
}

async function build() {
	await generateTypes();
	await writeLocalesJson();
}

function watch() {
	/** @type {NodeJS.Timeout | undefined} */
	let timer;
	let typesOutdated = false;

	// エディタの保存で複数回イベントが飛ぶことがあるのでまとめる
	/** @param {boolean} regenerateTypes */
	function schedule(regenerateTypes) {
		typesOutdated ||= regenerateTypes;
		clearTimeout(timer);
		timer = setTimeout(async () => {
			try {
				if (typesOutdated) {
					typesOutdated = false;
					await generateTypes();
				}
				await writeLocalesJson();
			} catch (err) {
				console.error(err);
			}
		}, 100);
	}

	fs.watch(localesDir, (_event, filename) => {
		if (filename == null || !filename.endsWith('.yml')) return;
		log(`locales changed: ${filename}`);
		schedule(true);
	});

	// バージョンは JSON のファイル名に含まれる
	fs.watch(_rootPackageJsonPath, () => {
		schedule(false);
	});

	log('watching locales...');
}

if (args.includes('--verify')) {
	verify();
} else {
	await build();

	if (args.includes('--watch')) {
		watch();
	}
}
