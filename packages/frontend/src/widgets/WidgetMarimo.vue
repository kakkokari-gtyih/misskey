<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkContainer :showHeader="widgetProps.showHeader" data-cy-mkw-marimo class="mkw-marimo">
	<template #icon><i class="ti ti-microscope"></i></template>
	<template #header>{{ i18n.ts._widgets.marimo }}</template>

	<div :class="$style.root">

		<img src="/client-assets/gravel.png" :class="$style.gravel" alt="" />
	</div>
</MkContainer>
</template>

<script lang="ts" setup>
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import MkContainer from '@/components/MkContainer.vue';
import { i18n } from '@/i18n.js';

const name = 'marimo';

const widgetPropsDef = {
	showHeader: {
		type: 'boolean',
		default: true,
	},
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	min-height: 250px;
	background-image: linear-gradient(to bottom, #BAF2ED, #93b9a3);
	/* 水槽のガラスのようなbox-shadow */
	box-shadow: inset 0 0 10px rgba(255, 255, 255, 0.6),
	            inset 0 0 20px rgba(255, 255, 255, 0.4),
	            inset 0 0 30px rgba(255, 255, 255, 0.2);
	overflow: clip;
}

.root::after {
	content: '';
	position: absolute;
	inset: 0;
	background-image: linear-gradient(to bottom, rgba(163, 229, 255, 0), rgb(147, 185, 163, .2));
	background-blend-mode: multiply;
}

.gravel {
	position: absolute;
	bottom: 0;
	left: 50%;
	transform: translateX(-50%);
	width: 100%;
	height: 20%;
	object-fit: cover;
	object-position: top;
	pointer-events: none;
	user-select: none;
}
</style>
