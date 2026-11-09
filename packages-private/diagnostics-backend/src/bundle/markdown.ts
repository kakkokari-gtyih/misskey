/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { renderSizeDiffDetails, renderVisualizerSummaryTable } from 'diagnostics-shared/bundle';
import type { BackendBundleReport } from './types';

export type RenderBundleReportOptions = {
	/** rollup-plugin-visualizer が出力したtreemap HTMLのartifact URL */
	visualizerArtifactUrl: string | null;
};

export function renderBundleReportMarkdown(base: BackendBundleReport, head: BackendBundleReport, options: RenderBundleReportOptions) {
	const lines = [
		'### Bundle Stats',
		'',
		renderSizeDiffDetails(base.chunks, head.chunks, {
			title: 'Chunk size diff',
			note: '_Sizes of the minified files in `packages/backend/built`. Chunks with the same name are summed._',
		}),
		'',
	];

	if (base.visualizer != null && head.visualizer != null) {
		lines.push(renderSizeDiffDetails(base.visualizer.packages, head.visualizer.packages, {
			title: 'Package size diff',
			label: 'Package',
			note: '_Pre-minification sizes of the modules bundled from each package._',
		}));
		lines.push('');
		lines.push(renderVisualizerSummaryTable(base.visualizer, head.visualizer, ['renderedLength']));
		lines.push('');
	} else {
		const missing = [base.visualizer == null ? 'base' : null, head.visualizer == null ? 'head' : null].filter(label => label != null);
		lines.push(`_Bundle visualizer stats are not available for ${missing.join(' and ')}._`);
		lines.push('');
	}

	if (options.visualizerArtifactUrl != null) {
		lines.push(`[Open treemap HTML](${options.visualizerArtifactUrl})`);
		lines.push('');
	}

	return `${lines.join('\n').trimEnd()}\n`;
}
