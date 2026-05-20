/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Directive } from 'vue';
import { makeHotkey } from '@/utility/hotkey.js';
import type { HotkeyCommandDefinition, Keymap } from '@/utility/hotkey.js';
import { prefer } from '@/preferences.js';

interface HTMLElementWithHotkey extends HTMLElement {
	_hotkey_global?: boolean;
	_keyHandler?: (ev: KeyboardEvent) => void;
}

const getHotkeyOverrides = () => ((prefer.r as unknown) as Record<string, { value: Record<string, string | null> }>)['hotkey.overrides'].value;

export const hotkeyDirective = {
	mounted(el, binding) {
		el._hotkey_global = binding.modifiers.global === true;

		el._keyHandler = makeHotkey(binding.value, undefined, getHotkeyOverrides);

		if (el._hotkey_global) {
			window.document.addEventListener('keydown', el._keyHandler, { passive: false });
		} else {
			el.addEventListener('keydown', el._keyHandler, { passive: false });
		}
	},

	unmounted(el) {
		if (el._keyHandler == null) return;
		if (el._hotkey_global) {
			window.document.removeEventListener('keydown', el._keyHandler);
		} else {
			el.removeEventListener('keydown', el._keyHandler);
		}
	},
} as Directive<HTMLElementWithHotkey, Keymap | HotkeyCommandDefinition[]>;
