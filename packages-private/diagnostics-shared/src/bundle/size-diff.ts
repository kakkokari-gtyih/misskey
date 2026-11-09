/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	calcAndFormatDeltaBytes,
	calcAndFormatDeltaPercentInMdTable,
	escapeMdTableCell,
	formatBytes,
} from '../format';

/**
 * base / head 間でサイズを比較する単位 (チャンク・パッケージ等)。
 */
export type SizeEntry = {
	/**
	 * ビルド間で安定する識別子。`null` のものは base/head で対応付けできないため、
	 * 個別行には出さず合計にだけ含める。
	 */
	comparisonKey: string | null;
	displayName: string;
	/** 行の詳細として表示する補足 (出力ファイル名など) */
	file: string;
	size: number;
};

/**
 * この差分以下の行は個別に出さず `(other)` にまとめる。
 * ハッシュ文字列の揺れ等でサイズが数バイト動くだけの行がノイズになるため。
 */
const smallDeltaThreshold = 5;

/** diff表に個別行として出す上限。これを超えた分は `(other)` に集約する */
const diffRowLimit = 30;

function entryDisplayName(entry: SizeEntry | undefined) {
	if (entry == null) return '';
	return entry.displayName || entry.file;
}

export function getSizeComparisonRows(keys: string[], base: Partial<Record<string, SizeEntry>>, head: Partial<Record<string, SizeEntry>>) {
	return keys.map(key => {
		const baseEntry = base[key];
		const headEntry = head[key];
		const baseSize = baseEntry?.size ?? 0;
		const headSize = headEntry?.size ?? 0;
		return {
			key,
			name: entryDisplayName(baseEntry ?? headEntry),
			baseFile: baseEntry?.file,
			headFile: headEntry?.file,
			baseSize,
			headSize,
			changeType: baseEntry == null ? 'added' : headEntry == null ? 'removed' : baseSize !== headSize ? 'updated' : 'unchanged',
			sortSize: Math.max(baseSize, headSize),
		};
	});
}

export type SizeComparisonRow = ReturnType<typeof getSizeComparisonRows>[number];

export type SizeAggregate = {
	baseSize: number;
	headSize: number;
	baseCount: number;
	headCount: number;
};

export function sumSizes(entries: SizeEntry[]) {
	return entries.reduce((sum, entry) => sum + entry.size, 0);
}

/**
 * 比較キーを持たない (= base/head で対応付けできない) エントリの合計。
 */
export function generatedAggregate(base: SizeEntry[], head: SizeEntry[]): SizeAggregate {
	const baseGenerated = base.filter(entry => entry.comparisonKey == null);
	const headGenerated = head.filter(entry => entry.comparisonKey == null);
	return {
		baseSize: sumSizes(baseGenerated),
		headSize: sumSizes(headGenerated),
		baseCount: baseGenerated.length,
		headCount: headGenerated.length,
	};
}

export function hasSmallDelta(row: SizeComparisonRow) {
	return Math.abs(row.headSize - row.baseSize) <= smallDeltaThreshold;
}

export function comparisonRowsAggregate(rows: SizeComparisonRow[]): SizeAggregate {
	return {
		baseSize: rows.reduce((sum, row) => sum + row.baseSize, 0),
		headSize: rows.reduce((sum, row) => sum + row.headSize, 0),
		baseCount: rows.filter(row => row.baseFile != null).length,
		headCount: rows.filter(row => row.headFile != null).length,
	};
}

export function comparableMap<T extends SizeEntry>(entries: T[]) {
	const pairs: [string, T][] = [];
	for (const entry of entries) {
		if (entry.comparisonKey != null) pairs.push([entry.comparisonKey, entry]);
	}
	return Object.fromEntries(pairs);
}

export function summarizeSizeChanges(rows: SizeComparisonRow[]) {
	return {
		updated: rows.filter((row) => row.changeType === 'updated').length,
		added: rows.filter((row) => row.changeType === 'added').length,
		removed: rows.filter((row) => row.changeType === 'removed').length,
	};
}

export function formatSizeChangeSummary(label: string, summary: ReturnType<typeof summarizeSizeChanges>) {
	return `${label} (${summary.updated} updated, ${summary.added} added, ${summary.removed} removed)`;
}

/**
 * 差分の絶対値が大きい順。同着は増加側・元サイズ・名前の順で決定的に並べる。
 */
export function compareSizeComparisonRows(a: SizeComparisonRow, b: SizeComparisonRow) {
	return Math.abs(b.headSize - b.baseSize) - Math.abs(a.headSize - a.baseSize)
		|| (b.headSize - b.baseSize) - (a.headSize - a.baseSize)
		|| b.sortSize - a.sortSize
		|| a.name.localeCompare(b.name);
}

export function sizeRowFileDisplay(row: SizeComparisonRow) {
	if (row.baseFile == null) return row.headFile ?? '';
	if (row.headFile == null || row.baseFile === row.headFile) return row.baseFile;
	return `${row.baseFile} → ${row.headFile}`;
}

/**
 * @param label 1列目の見出し (`Chunk` / `Package` など)
 */
export function sizeMarkdownTable(
	rows: SizeComparisonRow[],
	total?: { baseSize: number; headSize: number },
	generated?: SizeAggregate,
	other?: SizeAggregate,
	label = 'Chunk',
) {
	const hasGenerated = generated != null && (generated.baseCount > 0 || generated.headCount > 0);
	const hasOther = other != null && (other.baseCount > 0 || other.headCount > 0);
	if (rows.length === 0 && total == null && !hasGenerated && !hasOther) return '_No data_';

	const lines = [
		`| ${label} | Base | Head | Δ | Δ\u00A0(%) |`, // nbspにすること
		'| --- | ---: | ---: | ---: | ---: |',
	];
	if (total != null) {
		lines.push(`| (total) | ${formatBytes(total.baseSize)} | ${formatBytes(total.headSize)} | ${calcAndFormatDeltaBytes(total.baseSize, total.headSize, 1000)} | ${calcAndFormatDeltaPercentInMdTable(total.baseSize, total.headSize, 0.1)} |`);
		lines.push('| | | | | |');
	}

	for (const row of rows) {
		const file = sizeRowFileDisplay(row);
		if (row.changeType === 'added') {
			lines.push(`| <details><summary>\`${escapeMdTableCell(row.name)}\`</summary> \`${escapeMdTableCell(file)}\` </details> | ${formatBytes(row.baseSize)} | ${formatBytes(row.headSize)} | ${calcAndFormatDeltaBytes(row.baseSize, row.headSize, 1000)} | $\\color{orange}{\\text{( + )}}$ |`);
		} else if (row.changeType === 'removed') {
			lines.push(`| <details><summary>\`${escapeMdTableCell(row.name)}\`</summary> \`${escapeMdTableCell(file)}\` </details> | ${formatBytes(row.baseSize)} | ${formatBytes(row.headSize)} | ${calcAndFormatDeltaBytes(row.baseSize, row.headSize, 1000)} | $\\color{green}{\\text{( - )}}$ |`);
		} else {
			lines.push(`| <details><summary>\`${escapeMdTableCell(row.name)}\`</summary> \`${escapeMdTableCell(file)}\` </details> | ${formatBytes(row.baseSize)} | ${formatBytes(row.headSize)} | ${calcAndFormatDeltaBytes(row.baseSize, row.headSize, 1000)} | ${calcAndFormatDeltaPercentInMdTable(row.baseSize, row.headSize, 0.1)} |`);
		}
	}
	if (hasGenerated) {
		// eslint-disable-next-line no-irregular-whitespace
		lines.push(`| (other\u00A0generated\u00A0chunks) | ${formatBytes(generated.baseSize)} | ${formatBytes(generated.headSize)} | ${calcAndFormatDeltaBytes(generated.baseSize, generated.headSize, 1000)} | ${calcAndFormatDeltaPercentInMdTable(generated.baseSize, generated.headSize, 0.1)} |`); // nbspにすること
	}
	if (hasOther) {
		lines.push(`| (other) | ${formatBytes(other.baseSize)} | ${formatBytes(other.headSize)} | ${calcAndFormatDeltaBytes(other.baseSize, other.headSize, 1000)} | ${calcAndFormatDeltaPercentInMdTable(other.baseSize, other.headSize, 0.1)} |`);
	}
	return lines.join('\n');
}

export type RenderSizeDiffDetailsOptions = {
	/** `<summary>` に出す見出し。変化の件数が後ろに付く */
	title: string;
	/** 表の1列目の見出し */
	label?: string;
	/** 表の下に添える注記 (Markdown) */
	note?: string;
};

/**
 * base / head の全エントリを比較し、変化のあった行を差分の大きい順に並べた
 * 折りたたみ表 (`<details>`) を返す。
 */
export function renderSizeDiffDetails(base: SizeEntry[], head: SizeEntry[], options: RenderSizeDiffDetailsOptions) {
	const baseComparable = comparableMap(base);
	const headComparable = comparableMap(head);
	const allKeys = [...new Set([...Object.keys(baseComparable), ...Object.keys(headComparable)])];
	const allComparisonRows = getSizeComparisonRows(allKeys, baseComparable, headComparable);

	const changedRows = allComparisonRows.filter((row) => row.changeType !== 'unchanged');
	const diffSummary = summarizeSizeChanges(changedRows);
	const diffTotal = {
		baseSize: sumSizes(base),
		headSize: sumSizes(head),
	};
	const diffGenerated = generatedAggregate(base, head);
	const largeDeltaRows = changedRows.filter(row => !hasSmallDelta(row)).sort(compareSizeComparisonRows);
	const diffRows = largeDeltaRows.slice(0, diffRowLimit);
	// 表示上限で切り捨てた行も `(other)` に含める。落とすと合計が実際の変化量と合わなくなる
	const diffOther = comparisonRowsAggregate([
		...changedRows.filter(hasSmallDelta),
		...largeDeltaRows.slice(diffRowLimit),
	]);

	return [
		'<details>',
		`<summary>${formatSizeChangeSummary(options.title, diffSummary)}</summary>`,
		'',
		sizeMarkdownTable(diffRows, diffTotal, diffGenerated, diffOther, options.label),
		'',
		...(options.note == null ? [] : [options.note, '']),
		'</details>',
	].join('\n');
}
