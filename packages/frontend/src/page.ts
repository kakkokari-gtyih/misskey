/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { inject, isRef, onActivated, onBeforeUnmount, provide, ref, toValue, watch } from 'vue';
import { DI } from './di.js';
import type { MaybeRefOrGetter, Ref } from 'vue';
import { normalizeHotkeyCommands, registerHotkeyCommands, unregisterHotkeyCommands } from '@/utility/hotkey.js';
import type { HotkeyCommandDefinition, NormalizedHotkeyCommand } from '@/utility/hotkey.js';

export type PageMetadata = {
	title: string;
	subtitle?: string;
	icon?: string | null;
	avatar?: Misskey.entities.User | null;
	userName?: Misskey.entities.User | null;
	needWideArea?: boolean;
};

type PageMetadataGetter = () => PageMetadata;
type PageMetadataReceiver = (getter: PageMetadataGetter) => void;
type PageCommandsGetter = () => NormalizedHotkeyCommand[];
type PageCommandsReceiver = (getter: PageCommandsGetter) => void;

const RECEIVER_KEY = Symbol('ReceiverKey');
const setReceiver = (v: PageMetadataReceiver): void => {
	provide<PageMetadataReceiver>(RECEIVER_KEY, v);
};
const getReceiver = (): PageMetadataReceiver | undefined => {
	return inject<PageMetadataReceiver>(RECEIVER_KEY);
};

const METADATA_KEY = Symbol('MetadataKey');
const setMetadata = (v: Ref<PageMetadata | null>): void => {
	provide<Ref<PageMetadata | null>>(METADATA_KEY, v);
};

const COMMAND_RECEIVER_KEY = Symbol('CommandReceiverKey');
const setCommandReceiver = (v: PageCommandsReceiver): void => {
	provide<PageCommandsReceiver>(COMMAND_RECEIVER_KEY, v);
};
const getCommandReceiver = (): PageCommandsReceiver | undefined => {
	return inject<PageCommandsReceiver>(COMMAND_RECEIVER_KEY);
};

let pageCommandSourceId = 0;

export const definePage = (maybeRefOrGetterMetadata: MaybeRefOrGetter<PageMetadata>): void => {
	const metadataRef = ref(toValue(maybeRefOrGetterMetadata));
	const metadataGetter = () => metadataRef.value;
	const receiver = getReceiver();

	// setup handler
	receiver?.(metadataGetter);

	// update handler
	onBeforeUnmount(watch(
		() => toValue(maybeRefOrGetterMetadata),
		(metadata) => {
			metadataRef.value = metadata;
			receiver?.(metadataGetter);
		},
		{ deep: true },
	));
	onActivated(() => {
		receiver?.(metadataGetter);
	});

	provide(DI.pageMetadata, metadataRef);
};

export const definePageCommands = (maybeRefOrGetterCommands: MaybeRefOrGetter<HotkeyCommandDefinition[]>): void => {
	const source = `page:${++pageCommandSourceId}`;
	const commandsRef = ref(normalizeHotkeyCommands(toValue(maybeRefOrGetterCommands)));
	const commandsGetter = () => commandsRef.value;
	const receiver = getCommandReceiver();

	registerHotkeyCommands('page', source, toValue(maybeRefOrGetterCommands));
	receiver?.(commandsGetter);

	onBeforeUnmount(watch(
		() => toValue(maybeRefOrGetterCommands),
		(commands) => {
			commandsRef.value = normalizeHotkeyCommands(commands);
			registerHotkeyCommands('page', source, commands);
			receiver?.(commandsGetter);
		},
		{ deep: true },
	));
	onActivated(() => {
		registerHotkeyCommands('page', source, toValue(maybeRefOrGetterCommands));
		receiver?.(commandsGetter);
	});
	onBeforeUnmount(() => {
		unregisterHotkeyCommands('page', source);
	});

	provide(DI.pageCommands, commandsRef);
};

export const provideMetadataReceiver = (receiver: PageMetadataReceiver): void => {
	setReceiver(receiver);
};

export const providePageCommandReceiver = (receiver: PageCommandsReceiver): void => {
	setCommandReceiver(receiver);
};

export const provideReactiveMetadata = (metadataRef: Ref<PageMetadata | null>): void => {
	setMetadata(metadataRef);
};

export const provideReactivePageCommands = (commandsRef: Ref<NormalizedHotkeyCommand[]>): void => {
	provide(DI.pageCommands, commandsRef);
};
