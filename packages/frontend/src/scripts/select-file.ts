/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, defineAsyncComponent } from 'vue';
import * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { misskeyApi } from '@/scripts/misskey-api.js';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import { defaultStore } from '@/store.js';
import { uploadFile } from '@/scripts/upload.js';

export function chooseFileFromPc(multiple: boolean, keepOriginal = false): Promise<Misskey.entities.DriveFile[]> {
	return new Promise((res, rej) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = multiple;
		input.onchange = () => {
			if (!input.files) return res([]);
			const promises = Array.from(input.files, file => uploadFile(file, defaultStore.state.uploadFolder, undefined, keepOriginal));

			Promise.all(promises).then(driveFiles => {
				res(driveFiles);
			}).catch(err => {
				// アップロードのエラーは uploadFile 内でハンドリングされているためアラートダイアログを出したりはしてはいけない
			});

			// 一応廃棄
			(window as any).__misskey_input_ref__ = null;
		};

		// https://qiita.com/fukasawah/items/b9dc732d95d99551013d
		// iOS Safari で正常に動かす為のおまじない
		(window as any).__misskey_input_ref__ = input;

		input.click();
	});
}

export function chooseFileFromDrive(multiple: boolean): Promise<Misskey.entities.DriveFile[]> {
	return new Promise((res, rej) => {
		os.selectDriveFile(multiple).then(files => {
			res(files);
		});
	});
}

export function chooseFileFromUrl(): Promise<Misskey.entities.DriveFile> {
	return new Promise((res, rej) => {
		os.inputText({
			title: i18n.ts.uploadFromUrl,
			type: 'url',
			placeholder: i18n.ts.uploadFromUrlDescription,
		}).then(({ canceled, result: url }) => {
			if (canceled) return;

			const marker = Math.random().toString(); // TODO: UUIDとか使う

			const connection = useStream().useChannel('main');
			connection.on('urlUploadFinished', urlResponse => {
				if (urlResponse.marker === marker) {
					res(urlResponse.file);
					connection.dispose();
				}
			});

			misskeyApi('drive/files/upload-from-url', {
				url: url,
				folderId: defaultStore.state.uploadFolder,
				marker,
			});

			os.alert({
				title: i18n.ts.uploadFromUrlRequested,
				text: i18n.ts.uploadFromUrlMayTakeTime,
			});
		});
	});
}

export function launchSoundRecorder(): Promise<Misskey.entities.DriveFile> {
	return new Promise((res, rej) => {
		os.popup(defineAsyncComponent(() => import('@/components/MkSoundRecorderDialog.vue')), {}, {
			done: (file: Misskey.entities.DriveFile) => {
				res(file);
			},
			closed: () => {
				rej();
			},
		}, 'closed');
	});
}

function select(src: any, label: string | null, multiple: boolean, withSoundRecorder = false): Promise<Misskey.entities.DriveFile[]> {
	return new Promise((res, rej) => {
		const keepOriginal = ref(defaultStore.state.keepOriginalUploading);

		os.popupMenu([label ? {
			text: label,
			type: 'label',
		} : undefined, {
			type: 'switch',
			text: i18n.ts.keepOriginalUploading,
			ref: keepOriginal,
		}, {
			text: i18n.ts.upload,
			icon: 'ti ti-upload',
			action: () => chooseFileFromPc(multiple, keepOriginal.value).then(files => res(files)),
		}, {
			text: i18n.ts.fromDrive,
			icon: 'ti ti-cloud',
			action: () => chooseFileFromDrive(multiple).then(files => res(files)),
		}, {
			text: i18n.ts.fromUrl,
			icon: 'ti ti-link',
			action: () => chooseFileFromUrl().then(file => res([file])),
		}, ...(withSoundRecorder ? [{
			text: i18n.ts._soundRecorder.title,
			icon: 'ti ti-microphone',
			action: () => launchSoundRecorder().then(file => res([file])),
		}] : [])], src);
	});
}

export function selectFile(src: any, label: string | null = null, withSoundRecorder = false): Promise<Misskey.entities.DriveFile> {
	return select(src, label, false, withSoundRecorder).then(files => files[0]);
}

export function selectFiles(src: any, label: string | null = null, withSoundRecorder = false): Promise<Misskey.entities.DriveFile[]> {
	return select(src, label, true, withSoundRecorder);
}
