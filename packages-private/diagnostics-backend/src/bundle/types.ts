/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { SizeEntry, VisualizerReportSummary } from 'diagnostics-shared/bundle';

/** base / head それぞれについて `inspect-bundle` が出力するJSONレポート */
export type BackendBundleReport = {
	/** 出力ファイル単位のサイズ (minify 後) */
	chunks: SizeEntry[];
	/**
	 * rollup-plugin-visualizer 由来の集計。
	 * ビルド設定がまだ visualizer に対応していないリビジョン (導入前の base 等) では `null`
	 */
	visualizer: (VisualizerReportSummary & {
		/** パッケージ単位のサイズ (minify 前) */
		packages: SizeEntry[];
	}) | null;
};
