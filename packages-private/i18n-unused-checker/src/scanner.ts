/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ソースコードからプロパティアクセスの連鎖 (`a.b?.c['d'][e]`) と
 * キーパスらしき文字列リテラル (`'_email._follow.title'`) を抜き出す。
 * 構文解析はせず字句レベルで拾うため、コメントや文字列中のものも拾う (= 未使用判定は保守的になる)。
 */

export type Segment =
	| { kind: 'static'; name: string }
	| { kind: 'dynamic' };

export type Chain = Segment[];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

function skipWhitespace(src: string, i: number): number {
	while (i < src.length && /\s/.test(src[i])) i++;
	return i;
}

function readIdent(src: string, i: number): string | null {
	if (i >= src.length || !IDENT_START.test(src[i])) return null;
	let j = i + 1;
	while (j < src.length && IDENT_PART.test(src[j])) j++;
	return src.slice(i, j);
}

/** `src[open] === '['` に対応する `]` の位置を返す。文字列リテラル内の括弧は無視する */
function findClosingBracket(src: string, open: number): number {
	let depth = 0;
	let quote: string | null = null;
	for (let i = open; i < src.length; i++) {
		const c = src[i];
		if (quote) {
			if (c === '\\') i++;
			else if (c === quote) quote = null;
			continue;
		}
		if (c === '\'' || c === '"' || c === '`') quote = c;
		else if (c === '[') depth++;
		else if (c === ']' && --depth === 0) return i;
	}
	return -1;
}

const STATIC_INDEX = /^(['"`])([^'"`\\]*)\1$/;

function parseIndex(content: string): Segment {
	const m = STATIC_INDEX.exec(content.trim());
	if (m && !(m[1] === '`' && m[2].includes('${'))) return { kind: 'static', name: m[2] };
	return { kind: 'dynamic' };
}

function isChainStart(src: string, i: number): boolean {
	if (i > 0 && IDENT_PART.test(src[i - 1])) return false;
	// 直前が `.` (`?.` を含む) ならチェーンの途中
	let j = i - 1;
	while (j >= 0 && /\s/.test(src[j])) j--;
	return !(j >= 0 && src[j] === '.' && src[j - 1] !== '.');
}

export function extractChains(src: string): Chain[] {
	const chains: Chain[] = [];
	const identRe = /[A-Za-z_$][\w$]*/g;
	for (let m = identRe.exec(src); m != null; m = identRe.exec(src)) {
		if (!isChainStart(src, m.index)) continue;
		const chain: Chain = [{ kind: 'static', name: m[0] }];
		let i = m.index + m[0].length;
		for (;;) {
			// 計算プロパティは `[` の直前に空白を許さない (配列リテラルとの誤認を避ける)
			let bracket = -1;
			if (src[i] === '[') bracket = i;
			else if (src.startsWith('?.[', i)) bracket = i + 2;
			if (bracket !== -1) {
				const close = findClosingBracket(src, bracket);
				if (close === -1) break;
				chain.push(parseIndex(src.slice(bracket + 1, close)));
				i = close + 1;
				continue;
			}
			// メソッドチェーンの改行を許容する
			let j = skipWhitespace(src, i);
			if (src.startsWith('?.', j)) j += 2;
			else if (src[j] === '.' && src[j + 1] !== '.') j += 1;
			else break;
			const name = readIdent(src, skipWhitespace(src, j));
			if (name == null) break;
			chain.push({ kind: 'static', name });
			i = skipWhitespace(src, j) + name.length;
		}
		if (chain.length > 1) chains.push(chain);
	}
	return chains;
}

/** `i18n.t('_email._follow.title')` のような、ドット区切りのキーパスに見える文字列リテラル */
export function extractKeyPathLiterals(src: string): string[][] {
	const result: string[][] = [];
	const re = /(['"`])([\w$]+(?:\.[\w$]+)+)\1/g;
	for (let m = re.exec(src); m != null; m = re.exec(src)) {
		result.push(m[2].split('.'));
	}
	return result;
}
