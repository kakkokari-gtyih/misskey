/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { ref } from 'vue';
import { getHTMLElementOrNull } from '@/utility/get-dom-node-or-null.js';

//#region types
export type Keymap = Record<string, CallbackFunction | CallbackObject>;
export type HotkeyScope = 'global' | 'page' | 'component';
export type HotkeyText = string | (() => string);
export type HotkeyOverrideMap = Partial<Record<string, string | null>>;

type CallbackFunction = {
	(event: KeyboardEvent, origin: 'hotkey'): void;
	(event: null, origin: 'palette'): void;
};

type CallbackObject = {
	callback: CallbackFunction;
	allowRepeat?: boolean;
};

export type HotkeyCommandDefinition = {
	id: string;
	scope: HotkeyScope;
	name: HotkeyText;
	keywords?: HotkeyText[];
	callback: CallbackFunction;
	defaultKey?: string | null;
	allowRepeat?: boolean;
	editable?: boolean;
	palette?: {
		visible?: boolean;
		enabled?: boolean | (() => boolean);
		disabledReason?: HotkeyText;
	};
};

export type NormalizedHotkeyCommand = Omit<HotkeyCommandDefinition, 'keywords' | 'name' | 'palette'> & {
	name: string;
	keywords: string[];
	editable: boolean;
	palette: {
		visible: boolean;
		enabled: boolean;
		disabledReason: string | null;
	};
};

export type ResolvedHotkeyCommand = NormalizedHotkeyCommand & {
	effectiveKey: string | null;
};

type HotkeyRegistryEntry = {
	source: string;
	definitions: HotkeyCommandDefinition[];
	commands: NormalizedHotkeyCommand[];
};

type Pattern = {
	which: string[];
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
};

type Action = {
	patterns: Pattern[];
	callback: CallbackFunction;
	options: Required<Omit<CallbackObject, 'callback'>>;
};
//#endregion

//#region consts
const KEY_ALIASES = {
	'esc': 'Escape',
	'enter': 'Enter',
	'space': ' ',
	'up': 'ArrowUp',
	'down': 'ArrowDown',
	'left': 'ArrowLeft',
	'right': 'ArrowRight',
	'plus': ['+', ';'],
};

const MODIFIER_KEYS = ['ctrl', 'alt', 'shift'];

const IGNORE_ELEMENTS = ['input', 'textarea'];

const DEFAULT_DISABLED_REASON = 'このページでは使用できません';
//#endregion

//#region store
let latestHotkey: Pattern & { callback: CallbackFunction } | null = null;

const hotkeyRegistry: Record<HotkeyScope, Map<string, HotkeyRegistryEntry>> = {
	global: new Map(),
	page: new Map(),
	component: new Map(),
};
export const hotkeyRegistryVersion = ref(0);
//#endregion

//#region impl
export const makeHotkey = (
	keymap: Keymap | HotkeyCommandDefinition[] | (() => Keymap | HotkeyCommandDefinition[]),
	ignoreElements = IGNORE_ELEMENTS,
	resolveOverrides?: () => HotkeyOverrideMap | undefined,
) => {
	const getActions = () => {
		const resolvedKeymap = typeof keymap === 'function' ? keymap() : keymap;
		return parseKeymap(
			isKeymap(resolvedKeymap)
				? resolvedKeymap
				: compileHotkeyCommandsToKeymap(resolvedKeymap, resolveOverrides?.()),
		);
	};
	return (ev: KeyboardEvent) => {
		const actions = getActions();
		if ('pswp' in window && window.pswp != null) return;
		if (window.document.activeElement != null) {
			if (ignoreElements.includes(window.document.activeElement.tagName.toLowerCase())) return;
			if (getHTMLElementOrNull(window.document.activeElement)?.isContentEditable) return;
		}
		for (const action of actions) {
			if (matchPatterns(ev, action)) {
				ev.preventDefault();
				ev.stopPropagation();
				action.callback(ev, 'hotkey');
				storePattern(ev, action.callback);
			}
		}
	};
};

export function defineHotkeyCommands<const T extends HotkeyCommandDefinition[]>(commands: T): T {
	return commands;
}

export function normalizeHotkeyCommands(commands: HotkeyCommandDefinition[]): NormalizedHotkeyCommand[] {
	return commands.map((command) => {
		const paletteVisible = command.palette?.visible ?? command.scope !== 'component';
		const paletteEnabled = resolveBoolean(command.palette?.enabled, true);
		return {
			...command,
			name: resolveHotkeyText(command.name),
			keywords: (command.keywords ?? []).map(resolveHotkeyText),
			editable: command.editable ?? true,
			palette: {
				visible: paletteVisible,
				enabled: paletteEnabled,
				disabledReason: paletteEnabled ? null : resolveHotkeyText(command.palette?.disabledReason ?? DEFAULT_DISABLED_REASON),
			},
		};
	});
}

export function compileHotkeyCommandsToKeymap(commands: HotkeyCommandDefinition[], overrides?: HotkeyOverrideMap): Keymap {
	const normalizedCommands = resolveHotkeyCommands(normalizeHotkeyCommands(commands), overrides);
	const keymap = {} as Keymap;

	for (const command of normalizedCommands) {
		const effectiveKey = command.effectiveKey;
		if (effectiveKey == null || effectiveKey === '') continue;
		keymap[effectiveKey] = {
			callback: command.callback,
			allowRepeat: command.allowRepeat,
		};
	}

	return keymap;
}

export function resolveHotkeyCommands(commands: NormalizedHotkeyCommand[], overrides?: HotkeyOverrideMap): ResolvedHotkeyCommand[] {
	return commands.map((command) => ({
		...command,
		effectiveKey: overrides?.[command.id] ?? command.defaultKey ?? null,
	}));
}

export function registerHotkeyCommands(scope: HotkeyScope, source: string, commands: HotkeyCommandDefinition[]): void {
	hotkeyRegistry[scope].set(source, {
		source,
		definitions: commands,
		commands: normalizeHotkeyCommands(commands),
	});
	hotkeyRegistryVersion.value++;
}

export function unregisterHotkeyCommands(scope: HotkeyScope, source: string): void {
	if (hotkeyRegistry[scope].delete(source)) {
		hotkeyRegistryVersion.value++;
	}
}

export function getRegisteredHotkeyCommands(scope?: HotkeyScope): NormalizedHotkeyCommand[] {
	if (scope != null) {
		return Array.from(hotkeyRegistry[scope].values()).flatMap((entry) => entry.commands);
	}

	return (Object.keys(hotkeyRegistry) as HotkeyScope[])
		.flatMap((key) => Array.from(hotkeyRegistry[key].values()))
		.flatMap((entry) => entry.commands);
}

export function getRegisteredHotkeyCommandDefinitions(scope?: HotkeyScope): HotkeyCommandDefinition[] {
	if (scope != null) {
		return Array.from(hotkeyRegistry[scope].values()).flatMap((entry) => entry.definitions);
	}

	return (Object.keys(hotkeyRegistry) as HotkeyScope[])
		.flatMap((key) => Array.from(hotkeyRegistry[key].values()))
		.flatMap((entry) => entry.definitions);
}

export function getPaletteHotkeyCommands(overrides?: HotkeyOverrideMap): ResolvedHotkeyCommand[] {
	return resolveHotkeyCommands(
		getRegisteredHotkeyCommands().filter((command) => command.palette.visible),
		overrides,
	).sort((a, b) => Number(b.palette.enabled) - Number(a.palette.enabled) || a.name.localeCompare(b.name));
}

export function getEditableHotkeyCommands(overrides?: HotkeyOverrideMap): ResolvedHotkeyCommand[] {
	return getPaletteHotkeyCommands(overrides).filter((command) => command.editable);
}

export function findEditableHotkeyConflict(targetId: string, keybind: string, overrides?: HotkeyOverrideMap): ResolvedHotkeyCommand | null {
	const normalizedKeybind = keybind.trim();
	if (normalizedKeybind === '') return null;

	return getEditableHotkeyCommands(overrides).find((command) => command.id !== targetId && command.effectiveKey === normalizedKeybind) ?? null;
}

const parseKeymap = (keymap: Keymap) => {
	return Object.entries(keymap).map(([rawPatterns, rawCallback]) => {
		const patterns = parsePatterns(rawPatterns);
		const callback = parseCallback(rawCallback);
		const options = parseOptions(rawCallback);
		return { patterns, callback, options } as const satisfies Action;
	});
};

const parsePatterns = (rawPatterns: keyof Keymap) => {
	return rawPatterns.split('|').map(part => {
		const keys = part.split('+').map(trimLower);
		const which = parseKeyCode(keys.findLast(x => !MODIFIER_KEYS.includes(x)));
		const ctrl = keys.includes('ctrl');
		const alt = keys.includes('alt');
		const shift = keys.includes('shift');
		return { which, ctrl, alt, shift } as const satisfies Pattern;
	});
};

const parseCallback = (rawCallback: Keymap[keyof Keymap]) => {
	if (typeof rawCallback === 'object') {
		return rawCallback.callback;
	}
	return rawCallback;
};

const parseOptions = (rawCallback: Keymap[keyof Keymap]) => {
	const defaultOptions = {
		allowRepeat: false,
	} as const satisfies Action['options'];
	if (typeof rawCallback === 'object') {
		const { callback, ...rawOptions } = rawCallback;
		const options = { ...defaultOptions, ...rawOptions };
		return { ...options } as const satisfies Action['options'];
	}
	return { ...defaultOptions } as const satisfies Action['options'];
};

const matchPatterns = (ev: KeyboardEvent, action: Action) => {
	const { patterns, options, callback } = action;
	if (ev.repeat && !options.allowRepeat) return false;
	const key = ev.key.toLowerCase();
	return patterns.some(({ which, ctrl, shift, alt }) => {
		if (
			options.allowRepeat === false &&
			latestHotkey != null &&
			latestHotkey.which.includes(key) &&
			latestHotkey.ctrl === ctrl &&
			latestHotkey.alt === alt &&
			latestHotkey.shift === shift &&
			latestHotkey.callback === callback
		) {
			return false;
		}
		if (!which.includes(key)) return false;
		if (ctrl !== (ev.ctrlKey || ev.metaKey)) return false;
		if (alt !== ev.altKey) return false;
		if (shift !== ev.shiftKey) return false;
		return true;
	});
};

let lastHotKeyStoreTimer: number | null = null;

const storePattern = (ev: KeyboardEvent, callback: CallbackFunction) => {
	if (lastHotKeyStoreTimer != null) {
		window.clearTimeout(lastHotKeyStoreTimer);
	}

	latestHotkey = {
		which: [ev.key.toLowerCase()],
		ctrl: ev.ctrlKey || ev.metaKey,
		alt: ev.altKey,
		shift: ev.shiftKey,
		callback,
	};

	lastHotKeyStoreTimer = window.setTimeout(() => {
		latestHotkey = null;
	}, 500);
};

const parseKeyCode = (input?: string | null) => {
	if (input == null) return [];
	const raw = getValueByKey(KEY_ALIASES, input);
	if (raw == null) return [input];
	if (typeof raw === 'string') return [trimLower(raw)];
	return raw.map(trimLower);
};

const getValueByKey = <
	T extends Record<keyof any, unknown>,
	K extends keyof T | keyof any,
	R extends K extends keyof T ? T[K] : T[keyof T] | undefined,
>(obj: T, key: K) => {
	return obj[key] as R;
};

const trimLower = (str: string) => str.trim().toLowerCase();

const isKeymap = (input: Keymap | HotkeyCommandDefinition[]): input is Keymap => !Array.isArray(input);

const resolveHotkeyText = (value: HotkeyText) => typeof value === 'function' ? value() : value;

const resolveBoolean = (value: boolean | (() => boolean) | undefined, fallback: boolean) => {
	if (value == null) return fallback;
	return typeof value === 'function' ? value() : value;
};
//#endregion
