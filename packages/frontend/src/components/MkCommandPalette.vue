<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialogEl"
	:width="680"
	:height="560"
	@close="close()"
	@closed="emit('closed')"
	@esc="close()"
>
	<template #header>{{ i18n.ts.commandPalette }}</template>

	<div :class="$style.root">
		<div :class="$style.searchWrap">
			<MkInput
				ref="inputEl"
				v-model="query"
				autofocus
				type="search"
				:placeholder="i18n.ts._commandPalette.placeholder"
				@keydown="onInputKeydown"
			>
				<template #prefix><i class="ti ti-search"></i></template>
			</MkInput>
		</div>

		<div v-if="filteredCommands.length === 0" :class="$style.empty">
			<div :class="$style.emptyTitle">{{ i18n.ts._commandPalette.noResults }}</div>
			<div :class="$style.emptyText">{{ i18n.ts._commandPalette.noResultsDescription }}</div>
		</div>

		<div v-else ref="resultEl" :class="$style.results">
			<button
				v-for="(command, index) in filteredCommands"
				:key="command.id"
				type="button"
				:data-selected="selectedIndex === index ? 'true' : undefined"
				:class="[$style.item, {
					[$style.selected]: selectedIndex === index,
					[$style.disabled]: !command.palette.enabled,
				}]"
				@click="runCommand(command)"
				@mousemove="selectedIndex = index"
			>
				<div :class="$style.itemMain">
					<div :class="$style.itemName">{{ command.name }}</div>
					<div :class="$style.itemMeta">
						<span :class="$style.scope">{{ command.scope }}</span>
						<span :class="$style.id">{{ command.id }}</span>
					</div>
					<div v-if="!command.palette.enabled && command.palette.disabledReason" :class="$style.reason">{{ command.palette.disabledReason }}</div>
				</div>
				<div :class="$style.keybind">{{ formatHotkey(command.effectiveKey) }}</div>
			</button>
		</div>

		<div :class="$style.footer">
			<span>{{ i18n.ts._commandPalette.fixedShortcut }}</span>
			<span :class="$style.footerKeybind">Ctrl+K</span>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { i18n } from '@/i18n.js';
import { compareStringIncludes, initIntlString } from '@/utility/intl-string.js';
import { getPaletteHotkeyCommands, hotkeyRegistryVersion } from '@/utility/hotkey.js';
import { prefer } from '@/preferences.js';
import type { ResolvedHotkeyCommand } from '@/utility/hotkey.js';

initIntlString();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialogEl = useTemplateRef('dialogEl');
const inputEl = useTemplateRef('inputEl');
const resultEl = useTemplateRef('resultEl');

const query = ref('');
const selectedIndex = ref(0);

const commands = computed(() => {
	hotkeyRegistryVersion.value;
	return getPaletteHotkeyCommands(prefer.r['hotkey.overrides'].value);
});

const filteredCommands = computed(() => {
	const normalizedQuery = query.value.trim();
	if (normalizedQuery === '') {
		return commands.value;
	}

	return commands.value.filter((command) => {
		return [
			command.name,
			command.id,
			command.scope,
			command.effectiveKey ?? '',
			...command.keywords,
		].some((value) => compareStringIncludes(value, normalizedQuery));
	});
});

watch(filteredCommands, (value) => {
	selectedIndex.value = value.findIndex((command) => command.palette.enabled);
	if (selectedIndex.value < 0) {
		selectedIndex.value = 0;
	}

	nextTick(() => {
		const selectedEl = resultEl.value?.querySelector<HTMLElement>('[data-selected="true"]');
		selectedEl?.scrollIntoView({ block: 'nearest' });
	});
}, { immediate: true });

function close() {
	dialogEl.value?.close();
}

function moveSelection(delta: number) {
	if (filteredCommands.value.length === 0) return;

	const length = filteredCommands.value.length;
	selectedIndex.value = (selectedIndex.value + delta + length) % length;

	nextTick(() => {
		const selectedEl = resultEl.value?.querySelector<HTMLElement>('[data-selected="true"]');
		selectedEl?.scrollIntoView({ block: 'nearest' });
	});
}

function runCommand(command: ResolvedHotkeyCommand | undefined) {
	if (command == null || !command.palette.enabled) return;

	close();
	window.setTimeout(() => {
		command.callback(new KeyboardEvent('keydown'));
	}, 0);
}

function onInputKeydown(ev: KeyboardEvent) {
	if (ev.isComposing) return;

	if (ev.key === 'ArrowDown') {
		ev.preventDefault();
		moveSelection(1);
		return;
	}

	if (ev.key === 'ArrowUp') {
		ev.preventDefault();
		moveSelection(-1);
		return;
	}

	if (ev.key === 'Enter') {
		ev.preventDefault();
		runCommand(filteredCommands.value[selectedIndex.value]);
		return;
	}

	if (ev.key === 'Escape') {
		ev.preventDefault();
		close();
		return;
	}

	inputEl.value?.focus();
}

function formatHotkey(value: string | null): string {
	if (value == null || value === '') return ' - ';

	return value
		.split('|')
		.map((pattern) => pattern
			.split('+')
			.map((part) => {
				switch (part) {
					case 'ctrl': return 'Ctrl';
					case 'alt': return 'Alt';
					case 'shift': return 'Shift';
					case 'meta': return 'Meta';
					default: return part.length === 1 ? part.toUpperCase() : part;
				}
			})
			.join('+'))
		.join(' / ');
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
	background:
		radial-gradient(circle at top right, color-mix(in srgb, var(--MI_THEME-accent) 10%, transparent), transparent 34%),
		var(--MI_THEME-bg);
}

.searchWrap {
	padding: 16px;
	padding-bottom: 12px;
	border-bottom: 1px solid var(--MI_THEME-divider);
}

.results {
	flex: 1;
	overflow: auto;
	padding: 10px;
	container-type: inline-size;
}

.item {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 12px;
	align-items: center;
	width: 100%;
	padding: 12px 14px;
	text-align: left;
	border-radius: 12px;
	transition: background 0.15s ease, transform 0.15s ease;

	&:hover,
	&.selected {
		background: var(--MI_THEME-panelHighlight);
	}

	&.selected {
		transform: translateX(2px);
	}

	&.disabled {
		opacity: 0.6;
	}

	& + & {
		margin-top: 6px;
	}

	&:focus-visible {
		outline-offset: -2px;
	}
}

.itemMain {
	min-width: 0;
}

.itemName {
	font-weight: 700;
	word-break: break-word;
}

.itemMeta {
	margin-top: 4px;
	font-size: 0.8em;
	color: var(--MI_THEME-fgTransparentWeak);
	word-break: break-word;
}

.scope {
	display: inline-block;
	margin-right: 8px;
	padding: 2px 6px;
	border-radius: 999px;
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
	text-transform: uppercase;
	font-weight: 700;
	font-size: 0.85em;
}

.id {
	font-family: monospace;
	word-break: break-all;
}

.reason {
	margin-top: 6px;
	font-size: 0.8em;
	color: var(--MI_THEME-warn);
	word-break: break-word;
}

.keybind {
	font-family: monospace;
	font-size: 0.85em;
	padding: 6px 8px;
	border-radius: 8px;
	background: var(--MI_THEME-buttonBg);
	white-space: nowrap;
	align-self: start;
}

.empty {
	display: grid;
	place-content: center;
	gap: 8px;
	padding: 24px;
	flex: 1;
	text-align: center;
	color: var(--MI_THEME-fgTransparentWeak);
}

.emptyTitle {
	font-weight: 700;
	color: var(--MI_THEME-fg);
}

.emptyText {
	font-size: 0.9em;
	word-break: break-word;
}

.footer {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 16px 16px;
	border-top: 1px solid var(--MI_THEME-divider);
	font-size: 0.85em;
	color: var(--MI_THEME-fgTransparentWeak);
}

.footerKeybind {
	font-family: monospace;
	color: var(--MI_THEME-fg);
}
</style>
