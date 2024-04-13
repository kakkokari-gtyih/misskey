/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ignoreElements } from './hotkey.js';
import keyCode from './keycode.js';
import { globalEvents } from '@/events.js';

// コナミコマンド
export function eEggCommand() {
	const easterEgg = [
		'up',
		'up',
		'down',
		'down',
		'left',
		'right',
		'left',
		'right',
		'b',
		'a',
	];
	let easterEggPosition = 0;
	let eEggTimeout: number | null = null;

	return (ev: KeyboardEvent) => {
		if (document.activeElement) {
			if (ignoreElements.some(el => document.activeElement!.matches(el))) return;
			if (document.activeElement.attributes['contenteditable']) return;
		}

		const keys = keyCode(easterEgg[easterEggPosition]).map(k => k.toLowerCase());
		if (keys.includes(ev.key.toLowerCase())) {
			if (eEggTimeout !== null) {
				window.clearTimeout(eEggTimeout);
				eEggTimeout = null;
			}

			easterEggPosition++;

			if (easterEggPosition === easterEgg.length) {
				easterEggPosition = 0;
				globalEvents.emit('eEggCommandInvoked');
			} else {
				eEggTimeout = window.setTimeout(() => {
					easterEggPosition = 0;
				}, 5000);
			}
		} else {
			easterEggPosition = 0;
		}
	};
}
