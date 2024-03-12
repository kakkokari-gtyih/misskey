<template>
<MkModalWindow
	ref="dialog"
	:width="450"
	:height="500"
	@close="close()"
	@closed="$emit('closed')"
>
	<template #header>{{ i18n.ts._soundRecorder.title }}</template>

	<MkSpacer :marginMin="20" :marginMax="28">
		<div class="_gaps">
			<MkInfo v-if="!audioStream">
				<div class="_gaps_s">
					<div>{{ i18n.ts._soundRecorder.micRequestNeeded }}</div>
					<div class="_buttonsCenter">
						<MkButton primary @click="getPermission">{{ i18n.ts._soundRecorder.requestMicPermission }}</MkButton>
					</div>
				</div>
			</MkInfo>
			<MkSelect v-model="audioDeviceId">
				<template #label>{{ i18n.ts._soundRecorder.micForUse }}</template>
				<option v-for="device in audioDevices" :key="device.deviceId" :value="device.deviceId">{{ device.label }}</option>
			</MkSelect>
			<audio :class="$style.audio" :src="completedAudioDataUrl ?? undefined" controls></audio>
			<div class="_buttonsCenter">
				<MkButton v-if="recordStats === 'initializing' || recordStats === 'ready'" :disabled="recordStats === 'initializing'" primary large rounded @click="rec">{{ i18n.ts._soundRecorder.rec }}</MkButton>
				<MkButton v-else-if="recordStats === 'recording'" primary large rounded @click="stop">{{ i18n.ts._soundRecorder.stop }}</MkButton>
				<template v-else-if="recordStats === 'done'">
					<MkButton primary large rounded @click="uploadAndDone">{{ i18n.ts.upload }}</MkButton>
					<MkButton danger large rounded @click="reset">{{ i18n.ts.delete }}</MkButton>
				</template>
			</div>
		</div>
	</MkSpacer>
</MkModalWindow>
</template>

<script setup lang="ts">
import { shallowRef, ref, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { apiUrl } from '@/config.js';
import { $i } from '@/account.js';

const emit = defineEmits<{
	(ev: 'done', res: Misskey.entities.DriveFile): void;
	(ev: 'closed'): void;
}>();

const PREFERRED_MIME = [
	'audio/mpeg',
	'audio/ogg',
	'audio/opus',
	'audio/webm;codecs=opus',
	'audio/wav',
	'audio/webm',
];

const dialog = shallowRef<InstanceType<typeof MkModalWindow>>();

const audioStream = ref<MediaStream | null>(null);
let mediaRecorder: MediaRecorder | null = null;

const audioDevices = ref<MediaDeviceInfo[]>([]);

const audioDeviceId = ref<string | null>(null);

const recordStats = ref<'initializing' | 'ready' | 'recording' | 'done'>('initializing');

const audioData = ref<Blob[]>([]);

const extension = ref<string>('');

const completedAudioData = ref<Blob | null>(null);
const completedAudioDataUrl = ref<string | null>(null);

function getSupportedAudioMime() {
	return PREFERRED_MIME.find((mime) => {
		return MediaRecorder.isTypeSupported(mime);
	});
}

async function getPermission() {
	try {
		audioStream.value = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
			},
		});
		mediaRecorder = new MediaRecorder(audioStream.value, {
			mimeType: getSupportedAudioMime() ?? 'audio/wav',
			audioBitsPerSecond: 128000,
		});
		mediaRecorder.addEventListener('dataavailable', (ev) => {
			audioData.value.push(ev.data);
			const _gex = ev.data.type.match(/audio\/([^;]+)/);
			const _codexEx = ev.data.type.match(/;codecs=([^,]+)/);
			if (_codexEx) {
				extension.value = _codexEx[1];
			} else if (_gex) {
				extension.value = _gex[1];
			} else {
				extension.value = 'wav';
			}
		});
		mediaRecorder.addEventListener('stop', () => {
			completedAudioData.value = new Blob(audioData.value, { type: audioData.value[0].type });
			completedAudioDataUrl.value = URL.createObjectURL(completedAudioData.value);
			recordStats.value = 'done';
		});
		recordStats.value = 'ready';
	} catch (err: any) {
		console.error(err);
		await os.alert({
			type: 'error',
			text: i18n.ts._soundRecorder.micRequestFailed,
		});
	}
}

function rec() {
	if (recordStats.value === 'ready') {
		mediaRecorder?.start();
		recordStats.value = 'recording';
	}
}

function stop() {
	if (recordStats.value === 'recording') {
		mediaRecorder?.stop();
		recordStats.value = 'done';
	}
}

function reset() {
	audioData.value = [];
	completedAudioData.value = null;
	completedAudioDataUrl.value = null;
	recordStats.value = 'ready';
}

async function upload(): Promise<Misskey.entities.DriveFile | null> {
	if (completedAudioData.value && $i) {
		const formData = new FormData();
		formData.append('file', completedAudioData.value);
		formData.append('name', `audioRecorder-${Date.now()}.${extension.value}`);
		formData.append('isSensitive', 'false');
		formData.append('i', $i.token);
		const res = await window.fetch(apiUrl + '/drive/files/create', {
			method: 'POST',
			body: formData,
		});
		return await res.json();
	} else {
		return null;
	}
}

async function uploadAndDone() {
	const uploadPromise = upload();
	const res = await os.promiseDialog(uploadPromise);
	if (res) {
		emit('done', res);
		close();
	}
}

function close() {
	audioStream.value?.getTracks().forEach((track) => {
		track.stop();
	});
	audioStream.value = null;
	mediaRecorder = null;
	audioData.value = [];
	completedAudioData.value = null;
	completedAudioDataUrl.value = null;
	recordStats.value = 'initializing';
	dialog.value?.close();
}

onMounted(async () => {
	audioDevices.value = (await navigator.mediaDevices.enumerateDevices()).filter((v) => {
		return v.kind === 'audioinput';
	});

	audioDeviceId.value = audioDevices.value[0]?.deviceId ?? null;
});
</script>

<style module>
.audio {
	width: 100%;
}
</style>
