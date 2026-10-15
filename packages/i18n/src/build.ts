/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 言語ファイルのビルド用ユーティリティ (Node.js 専用)
 *
 * どのディレクトリの言語ファイルを扱うかは利用側が決める。
 * このモジュール自身はどの言語ファイルも読み込まない (import しても副作用はない)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { languages, primaries } from './const.js';
import type { Language } from './const.js';
import type { ILocale } from './types.js';
import type ts from 'typescript';

type PrimaryLang = keyof typeof primaries;

/**
 * オブジェクトを再帰的にマージする
 */
function merge<T extends ILocale>(...args: (T | ILocale | undefined)[]): T {
	return args.reduce<ILocale>((a, c) => ({
		...a,
		...c,
		...Object.entries(a)
			.filter(([k]) => c && typeof c[k] === 'object')
			.reduce<Record<string, ILocale[string]>>((acc, [k, v]) => {
				acc[k] = merge(v as ILocale, (c as ILocale)[k] as ILocale);
				return acc;
			}, {}),
	}), {} as ILocale) as T;
}

/**
 * 何故か文字列にバックスペース文字が混入することがあり、YAMLが壊れるので取り除く
 */
function clean(text: string) {
	return text.replace(new RegExp(String.fromCodePoint(0x08), 'g'), '');
}

/**
 * 空文字列が入ることがあり、フォールバックが動作しなくなるのでプロパティごと消す
 */
function removeEmpty<T extends ILocale>(obj: T): T {
	for (const [k, v] of Object.entries(obj)) {
		if (v === '') {
			delete obj[k];
		} else if (typeof v === 'object') {
			removeEmpty(v as ILocale);
		}
	}
	return obj;
}

function readLocaleFile(file: string, optional: boolean): ILocale {
	let text: string;
	try {
		text = fs.readFileSync(file, 'utf-8');
	} catch (err) {
		// 翻訳が未配信 (Crowdin から未同期) の言語はフォールバックに任せる
		if (optional && (err as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw err;
	}
	return (loadYaml(clean(text)) ?? {}) as ILocale;
}

/**
 * 指定ディレクトリの `{lang}.yml` をすべて読み込み、フォールバックを解決した言語ごとのオブジェクトを返す
 *
 * フォールバック順: ja-JP → en-US → 同一言語の primary (例: zh-TW なら zh-CN) → 各言語。
 * ja-JP 以外のファイルが存在しない場合は空として扱う
 * @param localesDir `ja-JP.yml` などが置かれたディレクトリ
 */
export function loadLocales<T extends ILocale>(localesDir: string): Record<Language, T> {
	const locales = languages.reduce<Record<Language, ILocale>>((a, lang) => {
		a[lang] = readLocaleFile(path.join(localesDir, `${lang}.yml`), lang !== 'ja-JP');
		return a;
	}, {} as Record<Language, ILocale>);

	removeEmpty(locales);

	return Object.entries(locales).reduce<Record<Language, T>>((a, [k, v]) => {
		const lang = k.split('-')[0];
		const key = k as Language;

		switch (key) {
			case 'ja-JP':
				a[key] = v as T;
				break;
			case 'ja-KS':
			case 'en-US':
				a[key] = merge<T>(locales['ja-JP'] as T, v);
				break;
			default: {
				const primaryLang = lang as PrimaryLang;
				const primaryKey = (lang in primaries ? `${lang}-${primaries[primaryLang]}` : undefined) as Language | undefined;
				a[key] = merge<T>(
					locales['ja-JP'] as T,
					locales['en-US'],
					primaryKey ? locales[primaryKey] : {},
					v,
				);
				break;
			}
		}

		return a;
	}, {} as Record<Language, T>);
}

export interface LocaleVerificationError {
	type: 'mismatched_type' | 'missing_parameter';
	lang: string;
	tree: string;
	data: {
		expected?: string;
		actual?: string;
		parameter?: string;
	};
}

/**
 * 基準言語と比較して、各言語の型の不一致やパラメータの欠落を検出する
 * @param locales {@link loadLocales} の戻り値
 * @param baseLanguage 基準とする言語
 */
export function verifyLocales(locales: Record<string, ILocale>, baseLanguage: Language = 'ja-JP'): LocaleVerificationError[] {
	const errors: LocaleVerificationError[] = [];

	function verify(expected: ILocale, actual: ILocale, lang: string, trace?: string): void {
		for (const key in expected) {
			if (!Object.prototype.hasOwnProperty.call(actual, key)) {
				continue;
			}
			const tree = trace ? `${trace}.${key}` : key;
			if (typeof expected[key] === 'object') {
				if (typeof actual[key] !== 'object') {
					errors.push({ type: 'mismatched_type', lang, tree, data: { expected: 'object', actual: typeof actual[key] } });
					continue;
				}
				verify(expected[key] as ILocale, actual[key] as ILocale, lang, tree);
			} else if (typeof expected[key] === 'string') {
				switch (typeof actual[key]) {
					case 'object':
						errors.push({ type: 'mismatched_type', lang, tree, data: { expected: 'string', actual: 'object' } });
						break;
					case 'undefined':
						continue;
					case 'string': {
						const expectedParameters = new Set((expected[key] as string).match(/\{[^}]+\}/g)?.map((s) => s.slice(1, -1)));
						const actualParameters = new Set((actual[key] as string).match(/\{[^}]+\}/g)?.map((s) => s.slice(1, -1)));
						for (const parameter of expectedParameters) {
							if (!actualParameters.has(parameter)) {
								errors.push({ type: 'missing_parameter', lang, tree, data: { parameter } });
							}
						}
					}
				}
			}
		}
	}

	const { [baseLanguage]: original, ...verifiees } = locales;

	for (const lang in verifiees) {
		verify(original, verifiees[lang], lang);
	}

	return errors;
}

interface LocaleRecord {
	[key: string]: string | LocaleRecord;
}

/**
 * 基準言語の言語ファイルから、翻訳キーの TypeScript インターフェースを生成する
 */
export async function generateLocaleInterface(options: {
	/** 基準言語の言語ファイル (例: `locales/ja-JP.yml`) */
	sourceFile: string;
	/** 出力先の .ts ファイル */
	outFile: string;
	/** 生成するインターフェース名 */
	typeName: string;
	/** `ILocale` / `ParameterizedString` の import 元 */
	typesModule: string;
	/** 生成ファイルの先頭に記載する生成元 */
	generatedBy: string;
}): Promise<void> {
	// 重いので必要になるまで読み込まない
	const { default: typescript } = await import('typescript');
	const parameterRegExp = /\{(\w+)\}/g;

	function createMemberType(item: string | LocaleRecord): ts.TypeNode {
		if (typeof item !== 'string') {
			return typescript.factory.createTypeLiteralNode(createMembers(item));
		}
		const parameters = Array.from(
			item.matchAll(parameterRegExp),
			([, parameter]) => parameter,
		);
		return parameters.length
			? typescript.factory.createTypeReferenceNode(
				typescript.factory.createIdentifier('ParameterizedString'),
				[
					typescript.factory.createUnionTypeNode(
						parameters.map((parameter) =>
							typescript.factory.createLiteralTypeNode(typescript.factory.createStringLiteral(parameter)),
						),
					),
				],
			)
			: typescript.factory.createKeywordTypeNode(typescript.SyntaxKind.StringKeyword);
	}

	function createMembers(record: LocaleRecord): ts.TypeElement[] {
		return Object.entries(record).map(([k, v]) => {
			const node = typescript.factory.createPropertySignature(
				undefined,
				typescript.factory.createStringLiteral(k),
				undefined,
				createMemberType(v),
			);
			if (typeof v === 'string') {
				typescript.addSyntheticLeadingComment(
					node,
					typescript.SyntaxKind.MultiLineCommentTrivia,
					`*
 * ${v.replace(/\n/g, '\n * ')}
 `,
					true,
				);
			}
			return node;
		});
	}

	const locale = loadYaml(fs.readFileSync(options.sourceFile, 'utf-8').toString()) as LocaleRecord;
	const members = createMembers(locale);

	const elements: ts.Statement[] = [
		typescript.factory.createImportDeclaration(
			undefined,
			typescript.factory.createImportClause(
				false,
				undefined,
				typescript.factory.createNamedImports([
					typescript.factory.createImportSpecifier(
						true,
						undefined,
						typescript.factory.createIdentifier('ILocale'),
					),
					typescript.factory.createImportSpecifier(
						true,
						undefined,
						typescript.factory.createIdentifier('ParameterizedString'),
					),
				]),
			),
			typescript.factory.createStringLiteral(options.typesModule),
			undefined,
		),
		typescript.factory.createInterfaceDeclaration(
			[typescript.factory.createToken(typescript.SyntaxKind.ExportKeyword)],
			typescript.factory.createIdentifier(options.typeName),
			undefined,
			[
				typescript.factory.createHeritageClause(typescript.SyntaxKind.ExtendsKeyword, [
					typescript.factory.createExpressionWithTypeArguments(
						typescript.factory.createIdentifier('ILocale'),
						undefined,
					),
				]),
			],
			members,
		),
	];

	typescript.addSyntheticLeadingComment(
		elements[0],
		typescript.SyntaxKind.MultiLineCommentTrivia,
		`
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 `,
		true,
	);
	typescript.addSyntheticLeadingComment(
		elements[0],
		typescript.SyntaxKind.MultiLineCommentTrivia,
		' eslint-disable ',
		true,
	);
	typescript.addSyntheticLeadingComment(
		elements[0],
		typescript.SyntaxKind.SingleLineCommentTrivia,
		` This file is generated by ${options.generatedBy}`,
		true,
	);
	typescript.addSyntheticLeadingComment(
		elements[0],
		typescript.SyntaxKind.SingleLineCommentTrivia,
		' Do not edit this file directly.',
		true,
	);

	const printed = typescript
		.createPrinter({
			newLine: typescript.NewLineKind.LineFeed,
		})
		.printList(
			typescript.ListFormat.MultiLine,
			typescript.factory.createNodeArray(elements),
			typescript.createSourceFile(
				path.basename(options.outFile),
				'',
				typescript.ScriptTarget.ESNext,
				true,
				typescript.ScriptKind.TS,
			),
		);

	const outDir = path.dirname(options.outFile);
	const tmpFile = path.join(outDir, `_${path.basename(options.outFile)}`);
	fs.mkdirSync(outDir, { recursive: true });

	// 一瞬ファイルが存在しなくなって途切れる→不安定になるらしいので、リネームで対処
	fs.writeFileSync(tmpFile, printed, 'utf-8');
	fs.renameSync(tmpFile, options.outFile);
}
