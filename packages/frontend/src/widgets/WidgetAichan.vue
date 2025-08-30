<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkContainer :naked="widgetProps.transparent" :showHeader="false" data-cy-mkw-aichan class="mkw-aichan">
	<iframe
		ref="live2d"
		:class="[$style.root, { [$style.loaded]: loaded }]"
		src="https://misskey-dev.github.io/mascot-web/?scale=1.5&y=1.1&eyeY=100"
	></iframe>
</MkContainer>
</template>

<script lang="ts" setup>
import { onUnmounted, useTemplateRef, ref } from 'vue';
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentProps, WidgetComponentEmits, WidgetComponentExpose } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';

const name = 'ai';

const widgetPropsDef = {
	transparent: {
		type: 'boolean',
		default: false,
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

const live2d = useTemplateRef('live2d');
const loaded = ref(false);

const onMousemove = (ev: MouseEvent) => {
	if (!live2d.value || !live2d.value.contentWindow) return;

	const iframeRect = live2d.value.getBoundingClientRect();
	live2d.value.contentWindow.postMessage({
		type: 'moveCursor',
		body: {
			x: ev.clientX - iframeRect.left,
			y: ev.clientY - iframeRect.top,
		},
	}, '*');
};

function messageEventHandler(ev: MessageEvent) {
	if (ev.origin === 'https://misskey-dev.github.io' && ev.data.type === 'loaded') {
		loaded.value = true;
		window.addEventListener('mousemove', onMousemove, { passive: true });
		window.removeEventListener('message', messageEventHandler);
	}
}

window.addEventListener('message', messageEventHandler);

onUnmounted(() => {
	window.removeEventListener('mousemove', onMousemove);
	window.removeEventListener('message', messageEventHandler);
});

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.root {
	width: 100%;
	height: 350px;
	border: none;
	pointer-events: none;
	color-scheme: light dark;
	opacity: 0;
	transition: opacity 0.3s ease;

	&.loaded {
		opacity: 1;
	}
}
</style>
