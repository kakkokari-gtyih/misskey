<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/preferences/hotkeys" :label="i18n.ts.hotkeys" :keywords="['hotkeys', 'shortcut', 'keybinding', 'keyboard']" icon="ti ti-keyboard">
	<div class="_gaps_m">
		<MkInfo>{{ i18n.ts._hotkeys.description }}</MkInfo>

		<MkInfo v-if="commands.length === 0">{{ i18n.ts._hotkeys.noAvailableCommands }}</MkInfo>

		<MkFolder v-for="command in commands" :key="command.id">
			<template #label>{{ command.name }}</template>
			<template #icon><i class="ti ti-keyboard"></i></template>
			<template #suffix>{{ command.editable ? (command.effectiveKey ?? i18n.ts._hotkeys.unassigned) : i18n.ts._hotkeys.fixed }}</template>

			<div class="_gaps_s">
				<MkInfo v-if="!command.palette.enabled" warn>{{ i18n.ts._hotkeys.unavailableHere }}</MkInfo>

				<div :class="$style.meta">
					<div>
						<div :class="$style.metaLabel">{{ i18n.ts._hotkeys.assignedKey }}</div>
						<div :class="$style.metaValue">{{ command.effectiveKey ?? i18n.ts._hotkeys.unassigned }}</div>
					</div>
					<div>
						<div :class="$style.metaLabel">{{ i18n.ts._hotkeys.defaultKey }}</div>
						<div :class="$style.metaValue">{{ command.defaultKey ?? i18n.ts._hotkeys.unassigned }}</div>
					</div>
				</div>

				<div v-if="command.editable" class="_buttons">
					<MkButton @click="editCommand(command)">{{ i18n.ts.edit }}</MkButton>
					<MkButton danger @click="disableCommand(command)">{{ i18n.ts._hotkeys.disableHotkey }}</MkButton>
					<MkButton @click="restoreDefault(command)" :disabled="!hasOverride(command.id)">{{ i18n.ts._hotkeys.restoreDefault }}</MkButton>
				</div>
			</div>
		</MkFolder>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { prefer } from '@/preferences.js';
import { findEditableHotkeyConflict, getPaletteHotkeyCommands } from '@/utility/hotkey.js';
import type { ResolvedHotkeyCommand } from '@/utility/hotkey.js';

const commands = computed(() => getPaletteHotkeyCommands(prefer.r['hotkey.overrides'].value));

function hasOverride(id: string): boolean {
	return Object.prototype.hasOwnProperty.call(prefer.s['hotkey.overrides'], id);
}

function commitOverrides(nextOverrides: Record<string, string | null>) {
	prefer.commit('hotkey.overrides', nextOverrides);
}

function restoreDefault(command: ResolvedHotkeyCommand) {
	const nextOverrides = { ...prefer.s['hotkey.overrides'] };
	delete nextOverrides[command.id];
	commitOverrides(nextOverrides);
}

function disableCommand(command: ResolvedHotkeyCommand) {
	commitOverrides({
		...prefer.s['hotkey.overrides'],
		[command.id]: null,
	});
}

async function editCommand(command: ResolvedHotkeyCommand) {
	const { canceled, result } = await os.inputText({
		title: i18n.ts._hotkeys.editKeybind,
		text: command.name,
		placeholder: command.defaultKey ?? null,
		default: command.effectiveKey ?? '',
	});
	if (canceled) return;

	const nextValue = result?.trim() ?? '';
	if (nextValue === '') {
		disableCommand(command);
		return;
	}

	const nextOverrides = {
		...prefer.s['hotkey.overrides'],
		[command.id]: nextValue,
	};
	const editableConflict = findEditableHotkeyConflict(command.id, nextValue, nextOverrides);
	if (editableConflict) {
		os.alert({
			type: 'error',
			text: `${i18n.ts._hotkeys.conflictWithEditable} ${editableConflict.name}`,
		});
		return;
	}

	commitOverrides(nextOverrides);

	const readonlyConflict = getPaletteHotkeyCommands(nextOverrides).find((registeredCommand) => {
		return registeredCommand.id !== command.id && !registeredCommand.editable && registeredCommand.effectiveKey === nextValue;
	});
	if (readonlyConflict) {
		os.alert({
			type: 'warning',
			text: `${i18n.ts._hotkeys.conflictWithReadonly} ${readonlyConflict.name}`,
		});
		return;
	}
	}

definePage(() => ({
	title: i18n.ts.hotkeys,
	icon: 'ti ti-keyboard',
}));
</script>

<style lang="scss" module>
.meta {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: 12px;
}

.metaLabel {
	font-size: 0.85em;
	opacity: 0.7;
	margin-bottom: 4px;
}

.metaValue {
	font-family: monospace;
	word-break: break-all;
}
</style>