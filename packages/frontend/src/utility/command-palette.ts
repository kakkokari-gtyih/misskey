/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineAsyncComponent } from 'vue';
import { popup } from '@/os.js';

let isCommandPaletteOpen = false;

export function openCommandPalette(): void {
	if (isCommandPaletteOpen) return;

	isCommandPaletteOpen = true;
	const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkCommandPalette.vue')), {}, {
		closed: () => {
			isCommandPaletteOpen = false;
			dispose();
		},
	});
}