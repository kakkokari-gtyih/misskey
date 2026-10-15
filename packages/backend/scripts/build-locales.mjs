// @ts-check

/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * サーバー向け言語ファイル (/locales-backend) から以下を生成する
 * - 翻訳キーの型 (src/i18n/autogen/locale.d.ts)
 * - 実行時に ServerI18nService が言語ごとに読み込む JSON (built/_backend_locales_)
 *
 * --watch: 言語ファイルの変更を監視して再生成する
 * --verify: 生成は行わず、言語ファイルの整合性検査のみ行う
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateLocaleInterface, loadLocales, verifyLocales } from 'i18n/build';

const _dirname = import.meta.dirname;
const localesDir = path.resolve(_dirname, '../../../locales-backend');
const outDir = path.resolve(_dirname, '../../../built/_backend_locales_');
const localeInterfaceFile = path.resolve(_dirname, '../src/i18n/autogen/locale.d.ts');

const args = process.argv.slice(2);

/** @param {string} message */
function log(message) {
	console.log(`[backend] ${message}`);
}

async function generateTypes() {
	await generateLocaleInterface({
		sourceFile: path.join(localesDir, 'ja-JP.yml'),
		outFile: localeInterfaceFile,
		typeName: 'BackendLocale',
		typesModule: 'i18n',
		generatedBy: 'packages/backend/scripts/build-locales.mjs',
	});
	log('locale interface generated.');
}

async function writeLocalesJson() {
	await fs.promises.mkdir(outDir, { recursive: true });

	for (const [lang, locale] of Object.entries(loadLocales(localesDir))) {
		await fs.promises.writeFile(path.join(outDir, `${lang}.json`), JSON.stringify(locale), 'utf-8');
	}
	log(`locales JSON written to ${outDir}`);
}

function verify() {
	const errors = verifyLocales(loadLocales(localesDir));

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

	fs.watch(localesDir, (_event, filename) => {
		if (filename == null || !filename.endsWith('.yml')) return;
		log(`locales changed: ${filename}`);

		// エディタの保存で複数回イベントが飛ぶことがあるのでまとめる
		clearTimeout(timer);
		timer = setTimeout(() => {
			build().catch(err => console.error(err));
		}, 100);
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
