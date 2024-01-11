<!--
SPDX-FileCopyrightText: syuilo and other misskey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header><MkPageHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs"/></template>
	<MkSpacer :contentMax="900">
		<div class="_gaps">
			<MkFolder v-for="customBubbleGame in customBubbleGames" :key="customBubbleGame.id ?? customBubbleGame._id" :defaultOpen="customBubbleGame.id == null">
				<template #label>{{ customBubbleGame.name }}</template>
				<template #caption>{{ customBubbleGame.description }}</template>

				<div class="_gaps_m">
					<MkInput v-model="customBubbleGame.name">
						<template #label>{{ i18n.ts.name }}</template>
					</MkInput>
					<MkTextarea v-model="customBubbleGame.description">
						<template #label>{{ i18n.ts.description }}</template>
					</MkTextarea>
					<MkFolder v-for="mono in customBubbleGame.mono" :key="mono.id">
						<template #label>Level {{ mono.level }}</template>

						<div class="_gaps_m">
							<MkInput v-model="mono.size" type="number">
								<template #label>Relative Size (In-game scale)</template>
							</MkInput>
							<MkRadios v-model="mono.shape">
								<template #label>Shape</template>
								<option value="circle">Circle</option>
								<option value="rectangle">Rectangle</option>
							</MkRadios>
							<MkInput v-model="mono.score" type="number">
								<template #label>Score</template>
							</MkInput>
							<MkSwitch v-model="mono.dropCandidate">
								<template #label>Drop candidate</template>
							</MkSwitch>
							<MkInput v-model="mono.sfxPitch" type="number">
								<template #label>SFX pitch</template>
							</MkInput>
							<MkInput v-model="mono.img">
								<template #label>Image URL</template>
							</MkInput>
							<MkInput v-model="mono.imgSize" type="number">
								<template #label>Image size</template>
							</MkInput>
							<MkInput v-model="mono.spriteScale" type="number">
								<template #label>Sprite scale</template>
							</MkInput>
						</div>
					</MkFolder>
					<div class="buttons _buttons">
						<MkButton class="button" inline primary @click="save(customBubbleGame)"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
						<MkButton v-if="customBubbleGame.id != null" class="button" inline danger @click="del(customBubbleGame)"><i class="ti ti-trash"></i> {{ i18n.ts.delete }}</MkButton>
					</div>
				</div>
			</MkFolder>
		</div>
	</MkSpacer>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import * as Misskey from 'misskey-js';
import { v4 as uuid } from 'uuid';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/scripts/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePageMetadata } from '@/scripts/page-metadata.js';
import MkFolder from '@/components/MkFolder.vue';

type Mono = {
	id: string;
	level: number;
	size: number;
	shape: 'circle' | 'rectangle';
	score: number;
	dropCandidate: boolean;
	sfxPitch: number;
	img: string;
	imgSize: number;
	spriteScale: number;
};

type CustomBubbleGameConfig = {
	_id: string;
	id: string | null;
	name: string;
	description: string;
	mono: Mono[];
};

const customBubbleGames = ref<CustomBubbleGameConfig[]>([]);
const NORMAL_BASE_SIZE = 30;

function add() {
	customBubbleGames.value.unshift({
		_id: Math.random().toString(36),
		id: null,
		name: '',
		description: '',
		mono: new Array(10).fill(null).map((_, i) => ({
			id: uuid(),
			level: (i + 1),
			size: NORMAL_BASE_SIZE * (1.25 ** i),
			shape: 'circle',
			score: 2 ** i,
			sfxPitch: 4 - 0.5 * i,
			dropCandidate: false,
			img: '',
			imgSize: 0,
			spriteScale: 1.12,
		})),
	});
}

function del(customBubbleGame) {
	os.confirm({
		type: 'warning',
		text: i18n.t('deleteAreYouSure', { x: customBubbleGame.name }),
	}).then(({ canceled }) => {
		if (canceled) return;
		customBubbleGames.value = customBubbleGames.value.filter(x => x !== customBubbleGame);
		//misskeyApi('admin/avatar-decorations/delete', customBubbleGame);
	});
}

async function save(customBubbleGame) {
	if (customBubbleGame.id == null) {
		//await os.apiWithDialog('admin/avatar-decorations/create', customBubbleGame);
		load();
	} else {
		//os.apiWithDialog('admin/avatar-decorations/update', customBubbleGame);
	}
}

function load() {
	/*
	misskeyApi('admin/avatar-decorations/list').then(_customBubbleGames => {
		customBubbleGames.value = _customBubbleGames;
	});
	*/
}

load();

const headerActions = computed(() => [{
	asFullButton: true,
	icon: 'ti ti-plus',
	text: i18n.ts.add,
	handler: add,
}]);

const headerTabs = computed(() => []);

definePageMetadata({
	title: i18n.ts.bubbleGame,
	icon: 'ti ti-apple',
});
</script>
