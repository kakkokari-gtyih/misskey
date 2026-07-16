<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<template v-if="player.url && playerEnabled">
	<div
		:class="$style.player"
		:style="player.width ? `padding: ${(player.height || 0) / player.width * 100}% 0 0` : `padding: ${(player.height || 0)}px 0 0`"
	>
		<iframe
			v-if="player.url.startsWith('http://') || player.url.startsWith('https://')"
			sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts allow-storage-access-by-user-activation allow-same-origin"
			scrolling="no"
			:allow="player.allow == null ? 'autoplay;encrypted-media;fullscreen' : player.allow.filter(x => ['autoplay', 'clipboard-write', 'fullscreen', 'encrypted-media', 'picture-in-picture', 'web-share'].includes(x)).join(';')"
			:class="$style.playerIframe"
			:src="transformPlayerUrl(player.url)"
			:style="{ border: 0 }"
		></iframe>
		<span v-else>invalid url</span>
	</div>
	<div :class="$style.action">
		<MkButton :small="true" inline @click="playerEnabled = false">
			<i class="ti ti-x"></i> {{ i18n.ts.disablePlayer }}
		</MkButton>
	</div>
</template>
<template v-else-if="tweetId && tweetExpanded">
	<div ref="twitter">
		<iframe
			ref="tweet"
			allow="fullscreen;web-share"
			sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin"
			scrolling="no"
			:style="{ position: 'relative', width: '100%', height: `${tweetHeight}px`, border: 0 }"
			:src="`https://platform.twitter.com/embed/index.html?embedId=${embedId}&amp;hideCard=false&amp;hideThread=false&amp;lang=en&amp;theme=${store.s.darkMode ? 'dark' : 'light'}&amp;id=${tweetId}`"
		></iframe>
	</div>
	<div :class="$style.action">
		<MkButton :small="true" inline @click="tweetExpanded = false">
			<i class="ti ti-x"></i> {{ i18n.ts.close }}
		</MkButton>
	</div>
</template>
<div v-else>
	<component :is="self ? 'MkA' : 'a'" :class="[$style.link, { [$style.compact]: compact }]" :[attr]="maybeRelativeUrl" rel="nofollow noopener" :target="target" :title="url">
		<div v-if="thumbnail && !sensitive" :class="$style.thumbnail" :style="prefer.s.dataSaver.urlPreviewThumbnail ? '' : { backgroundImage: `url('${thumbnail}')` }">
		</div>
		<article :class="$style.body">
			<header :class="$style.header">
				<h1 v-if="unknownUrl" :class="$style.title">{{ url }}</h1>
				<h1 v-else-if="fetching" :class="$style.title"><MkEllipsis/></h1>
				<h1 v-else :class="$style.title" :title="title ?? undefined">{{ title }}</h1>
			</header>
			<p v-if="unknownUrl" :class="$style.text">{{ i18n.ts.failedToPreviewUrl }}</p>
			<p v-else-if="fetching" :class="$style.text"><MkEllipsis/></p>
			<p v-else-if="description" :class="$style.text" :title="description">{{ description.length > 85 ? description.slice(0, 85) + '…' : description }}</p>
			<footer :class="$style.footer">
				<img v-if="icon" :class="$style.siteIcon" :src="icon"/>
				<p v-if="unknownUrl" :class="$style.siteName">{{ requestUrl.host }}</p>
				<p v-else-if="fetching" :class="$style.siteName"><MkEllipsis/></p>
				<p v-else :class="$style.siteName" :title="sitename ?? requestUrl.host">{{ sitename ?? requestUrl.host }}</p>
			</footer>
		</article>
	</component>
	<template v-if="showActions">
		<div v-if="tweetId" :class="$style.action">
			<MkButton :small="true" inline @click="tweetExpanded = true">
				<i class="ti ti-brand-x"></i> {{ i18n.ts.expandTweet }}
			</MkButton>
		</div>
		<div v-if="!playerEnabled && player.url" :class="$style.action">
			<MkButton :small="true" inline @click="playerEnabled = true">
				<i class="ti ti-player-play"></i> {{ i18n.ts.enablePlayer }}
			</MkButton>
			<MkButton v-if="!isMobile" :small="true" inline @click="openPlayer()">
				<i class="ti ti-picture-in-picture"></i> {{ i18n.ts.openInWindow }}
			</MkButton>
		</div>
	</template>
</div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onDeactivated, onUnmounted, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { url as local } from '@@/js/config.js';
import { versatileLang } from '@@/js/intl-const.js';
import type { SummalyResult } from '@misskey-dev/summaly';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { deviceKind } from '@/utility/device-kind.js';
import MkButton from '@/components/MkButton.vue';
import { transformPlayerUrl } from '@/utility/url-preview.js';
import { store } from '@/store.js';
import { prefer } from '@/preferences.js';
import { maybeMakeRelative } from '@@/js/url.js';

const props = withDefaults(defineProps<{
	url: string | SummalyResult | NonNullable<Misskey.entities.Note['urlPreviews']>[number];
	detail?: boolean;
	compact?: boolean;
	showActions?: boolean;
}>(), {
	detail: false,
	compact: false,
	showActions: true,
});

const MOBILE_THRESHOLD = 500;
const isMobile = ref(deviceKind === 'smartphone' || window.innerWidth <= MOBILE_THRESHOLD);

const maybeRelativeUrl = computed(() => summalyResult.value?.url ? maybeMakeRelative(summalyResult.value.url, local) : null);
const self = computed(() => maybeRelativeUrl.value !== summalyResult.value?.url);
const attr = computed(() => self.value ? 'to' : 'href');
const target = computed(() => self.value ? null : '_blank');
const fetching = ref(true);
const unknownUrl = ref(false);
const summalyResult = ref<SummalyResult | null>(null);
const requestUrl = computed(() => {
	let _url: URL;
	if (typeof props.url === 'string') {
		_url = new URL(props.url, window.location.href);
	} else {
		_url = new URL(props.url.url, window.location.href);
	}

	_url.hash = '';
	return _url;
});
const title = computed(() => summalyResult.value?.title ?? null);
const description = computed(() => summalyResult.value?.description ?? null);
const thumbnail = computed(() => summalyResult.value?.thumbnail ?? null);
const icon = computed(() => summalyResult.value?.icon ?? null);
const sitename = computed(() => summalyResult.value?.sitename ?? null);
const sensitive = computed(() => summalyResult.value?.sensitive ?? false);
const player = computed(() => summalyResult.value?.player ?? { url: null, width: null, height: null });
const playerEnabled = ref(false);
const tweetId = ref<string | null>(null);
const tweetExpanded = ref(props.detail);
const embedId = `embed${Math.random().toString().replace(/\D/, '')}`;
const tweetHeight = ref(150);

onDeactivated(() => {
	playerEnabled.value = false;
});

function adjustTweetHeight(message: MessageEvent) {
	if (message.origin !== 'https://platform.twitter.com') return;
	const embed = message.data?.['twttr.embed'];
	if (embed?.method !== 'twttr.private.resize') return;
	if (embed?.id !== embedId) return;
	const height = embed?.params[0]?.height;
	if (height) tweetHeight.value = height;
}

function openPlayer(): void {
	if (!summalyResult.value) return;

	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkYouTubePlayer.vue')), {
		urlOrSummalyResult: summalyResult.value,
	}, {
		closed: () => {
			dispose();
		},
	});
}

watch(() => props.url, async (to) => {
	if (typeof to === 'string') {
		fetching.value = true;

		if (!['http:', 'https:'].includes(requestUrl.value.protocol)) {
			summalyResult.value = null;
			fetching.value = false;
			unknownUrl.value = true;
			return;
		}

		const res = await window.fetch(`/url?url=${encodeURIComponent(requestUrl.value.href)}&lang=${versatileLang}`);
		if (!res.ok) {
			if (_DEV_) {
				console.warn(`[HTTP${res.status}] Failed to fetch url preview`);
			}
			summalyResult.value = null;
			fetching.value = false;
			unknownUrl.value = true;
			return;
		}

		const info: SummalyResult | null = await res.json();
		if (!info || info.url == null) {
			summalyResult.value = null;
			fetching.value = false;
			unknownUrl.value = true;
			return;
		}

		summalyResult.value = info;
	} else {
		summalyResult.value = to as SummalyResult;
	}

	if (requestUrl.value.hostname === 'twitter.com' || requestUrl.value.hostname === 'mobile.twitter.com' || requestUrl.value.hostname === 'x.com' || requestUrl.value.hostname === 'mobile.x.com') {
		const m = requestUrl.value.pathname.match(/^\/.+\/status(?:es)?\/(\d+)/);
		if (m) tweetId.value = m[1];
	}

	if (requestUrl.value.hostname === 'music.youtube.com' && requestUrl.value.pathname.match('^/(?:watch|channel)')) {
		requestUrl.value.hostname = 'www.youtube.com';
	}

	unknownUrl.value = false;
	fetching.value = false;
}, { immediate: true });

window.addEventListener('message', adjustTweetHeight);

onUnmounted(() => {
	window.removeEventListener('message', adjustTweetHeight);
});
</script>

<style lang="scss" module>
.player {
	position: relative;
	width: 100%;
}

.disablePlayer {
	position: absolute;
	top: -1.5em;
	right: 0;
	font-size: 1em;
	width: 1.5em;
	height: 1.5em;
	padding: 0;
	margin: 0;
	color: var(--MI_THEME-fg);
	background: rgba(128, 128, 128, 0.2);
	opacity: 0.7;

	&:hover {
		opacity: 0.9;
	}
}

.playerIframe {
	height: 100%;
	left: 0;
	position: absolute;
	top: 0;
	width: 100%;
}

.link {
	position: relative;
	display: block;
	font-size: 14px;
	box-shadow: 0 0 0 1px var(--MI_THEME-divider);
	border-radius: 8px;
	overflow: clip;
	text-align: left;

	&:hover {
		text-decoration: none;
		border-color: rgba(0, 0, 0, 0.2);

		> .body > .header > .title {
			text-decoration: underline;
		}
	}

	&.compact {
		> .body {
			> .header .title, .text, .footer {
				overflow: hidden;
				white-space: nowrap;
				text-overflow: ellipsis;
			}
		}
	}
}

.thumbnail {
	position: absolute;
	width: 100px;
	height: 100%;
	background-position: center;
	background-size: cover;
	background-color: var(--MI_THEME-bg);
	display: flex;
	justify-content: center;
	align-items: center;

	& + .body {
		left: 100px;
		width: calc(100% - 100px);
	}
}

.body {
	position: relative;
	box-sizing: border-box;
	padding: 16px;
}

.header {
	margin-bottom: 8px;
}

.title {
	margin: 0;
	font-size: 1em;
}

.text {
	margin: 0;
	font-size: 0.8em;
}

.footer {
	margin-top: 8px;
	height: 16px;
}

.siteIcon {
	display: inline-block;
	width: 16px;
	height: 16px;
	margin-right: 4px;
	vertical-align: top;
}

.siteName {
	display: inline-block;
	margin: 0;
	font-size: 0.8em;
	line-height: 16px;
	vertical-align: top;
}

.action {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
	margin-top: 6px;
}

@container (max-width: 400px) {
	.link {
		font-size: 12px;
	}

	.thumbnail {
		height: 80px;
	}

	.body {
		padding: 12px;
	}
}

@container (max-width: 350px) {
	.link {
		font-size: 10px;

		&.compact {
			> .thumbnail {
				position: absolute;
				width: 56px;
				height: 100%;
			}

			> .body {
				left: 56px;
				width: calc(100% - 56px);
				padding: 4px;

				> .header {
					margin-bottom: 2px;
				}

				> .footer {
					margin-top: 2px;
				}
			}
		}
	}

	.thumbnail {
		height: 70px;
	}

	.body {
		padding: 8px;
	}

	.header {
		margin-bottom: 4px;
	}

	.footer {
		margin-top: 4px;
	}

	.siteIcon {
		width: 12px;
		height: 12px;
	}
}
</style>
