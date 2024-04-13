/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ignoreElements } from './hotkey.js';
import keyCode from './keycode.js';
import { globalEvents } from '@/events.js';

// コナミコマンド
export let eEggCommandHandlerLoaded = false;
export function eEggCommand() {
	eEggCommandHandlerLoaded = true;

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

	return (ev: KeyboardEvent) => {
		if (document.activeElement) {
			if (ignoreElements.some(el => document.activeElement!.matches(el))) return;
			if (document.activeElement.attributes['contenteditable']) return;
		}

		const keys = keyCode(easterEgg[easterEggPosition]).map(k => k.toLowerCase());
		if (keys.includes(ev.key.toLowerCase())) {
			easterEggPosition++;
			if (easterEggPosition === easterEgg.length) {
				easterEggPosition = 0;
				globalEvents.emit('eEggCommandInvoked');
			}
		} else {
			easterEggPosition = 0;
		}
	};
}
