<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.signinRoot">
	<Transition
		mode="out-in"
		:enterActiveClass="$style.transition_enterActive"
		:leaveActiveClass="$style.transition_leaveActive"
		:enterFromClass="$style.transition_enterFrom"
		:leaveToClass="$style.transition_leaveTo"

		:inert="waiting"
	>
		<!-- 1. 外部サーバーへの転送・username入力・パスキー -->
		<XInput
			v-if="page === 'input'"
			key="input"
			ref="inputPageEl"
			:message="message"
			:openOnRemote="openOnRemote"
			:initialUsername="initialUsername"

			@usernameSubmitted="onUsernameSubmitted"
		/>

		<!-- 2. パスワード入力 -->
		<XPassword
			v-else-if="page === 'password'"
			key="password"

			:user="userInfo!"

			@passwordSubmitted="onPasswordSubmitted"
		/>

		<!-- 3. ワンタイムパスワード -->
		<XTotp
			v-else-if="page === 'totp'"
			key="totp"

			@totpSubmitted="onTotpSubmitted"
		/>

		<!-- 4. パスキー -->
		<XPasskey
			v-else-if="page === 'passkey'"
			key="passkey"

			:credentialRequest="credentialRequest!"

			@done="onPasskeyDone"
			@useTotp="onUseTotp"
		/>
	</Transition>
	<div v-if="waiting" :class="$style.waitingRoot">
		<MkLoading/>
	</div>
</div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON, AuthenticationResponseJSON } from '@simplewebauthn/browser';
import type { OpenOnRemoteOptions } from '@/utility/please-login.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { showSuspendedDialog } from '@/utility/show-suspended-dialog.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { login } from '@/accounts.js';
import { authUrl } from '@@/js/config.js';

import XInput from '@/components/MkSignin.input.vue';
import XPassword from '@/components/MkSignin.password.vue';
import XTotp from '@/components/MkSignin.totp.vue';
import XPasskey from '@/components/MkSignin.passkey.vue';

const emit = defineEmits<{
	(ev: 'login', v: Misskey.entities.SigninFlowSuccessResponse): void;
}>();

const props = withDefaults(defineProps<{
	autoSet?: boolean;
	message?: string,
	openOnRemote?: OpenOnRemoteOptions,
	initialUsername?: string;
}>(), {
	autoSet: false,
	message: '',
	openOnRemote: undefined,
	initialUsername: undefined,
});

const page = ref<'input' | 'password' | 'totp' | 'passkey'>('input');
const waiting = ref(false);

const inputPageEl = useTemplateRef('inputPageEl');

const signinSession = shallowRef<Misskey.entities.SigninFlowInitResponse | null>(null);

const userInfo = ref<null | Misskey.entities.UserDetailed>(null);
const password = ref('');

const credentialRequest = ref<PublicKeyCredentialRequestOptionsJSON | null>(null);
function onUseTotp(): void {
	page.value = 'totp';
}

async function onUsernameSubmitted(ur: Omit<Misskey.entities.SigninFlowContinueRequestUsername, 'sessionId'>) {
	waiting.value = true;

	userInfo.value = await misskeyApi('users/show', {
		username: ur.username,
	}).catch(() => null);

	await tryLogin({
		...ur,
	});
}

async function onPasswordSubmitted(pw: string) {
	waiting.value = true;
	password.value = pw;

	if (userInfo.value == null) {
		await os.alert({
			type: 'error',
			title: i18n.ts.noSuchUser,
			text: i18n.ts.signinFailed,
		});
		waiting.value = false;
		return;
	} else {
		await tryLogin({
			password: pw,
		});
	}
}

async function onTotpSubmitted(token: string) {
	waiting.value = true;

	if (userInfo.value == null) {
		await os.alert({
			type: 'error',
			title: i18n.ts.noSuchUser,
			text: i18n.ts.signinFailed,
		});
		waiting.value = false;
		return;
	} else {
		await tryLogin({
			username: userInfo.value.username,
			password: password.value,
			token,
		});
	}
}

async function onPasskeyDone(credential: AuthenticationResponseJSON) {
	waiting.value = true;

	await tryLogin({
		passkeyCredential: credential,
	});
}

async function tryLogin(req: Omit<Misskey.entities.SigninFlowContinueRequest, 'sessionId'>): Promise<Misskey.entities.SigninFlowResponse> {
	if (signinSession.value == null) {
		throw new Error('Signin session is not initialized');
	}

	const _req = {
		sessionId: signinSession.value.sessionId,
		...req,
	} as Misskey.entities.SigninFlowContinueRequest;

	return await window.fetch(`${authUrl}/signin`, {
		credentials: 'omit',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(_req),
	}).then(async (res) => {
		const json = await res.json() as Misskey.entities.SigninFlowResponse;
		if (res.ok) {
			return json;
		} else {
			onSigninApiError(json);
			return Promise.reject(json);
		}
	}).catch((err) => {
		onSigninApiError(err);
		return Promise.reject(err);
	}).then(async (res) => {
		if ('id' in res) {
			emit('login', res);
			await onLoginSucceeded(res);
		} else if ('next' in res) {
			switch (res.next) {
				case 'password': {
					page.value = 'password';
					break;
				}
				case 'totp': {
					page.value = 'totp';
					break;
				}
				case 'passkey': {
					if (browserSupportsWebAuthn()) {
						credentialRequest.value = res.passkeyOptions;
						page.value = 'passkey';
					} else {
						page.value = 'totp';
					}
					break;
				}
			}

			inputPageEl.value?.resetCaptcha();
			nextTick(() => {
				waiting.value = false;
			});
		}
		return res;
	});
}

async function onLoginSucceeded(res: Misskey.entities.SigninFlowSuccessResponse): Promise<void> {
	if (props.autoSet) {
		await login(res);
	}
}

function onSigninApiError(err?: any): void {
	const id = err?.error?.id ?? null;

	switch (id) {
		case '6cc579cc-885d-43d8-95c2-b8c7fc963280': {
			os.alert({
				type: 'error',
				title: i18n.ts.loginFailed,
				text: i18n.ts.noSuchUser,
			});
			break;
		}
		case '932c904e-9460-45b7-9ce6-7ed33be7eb2c': {
			os.alert({
				type: 'error',
				title: i18n.ts.loginFailed,
				text: i18n.ts.incorrectPassword,
			});
			break;
		}
		case 'e03a5f46-d309-4865-9b69-56282d94e1eb': {
			showSuspendedDialog();
			break;
		}
		case '22d05606-fbcf-421a-a2db-b32610dcfd1b': {
			os.alert({
				type: 'error',
				title: i18n.ts.loginFailed,
				text: i18n.ts.rateLimitExceeded,
			});
			break;
		}
		case 'cdf1235b-ac71-46d4-a3a6-84ccce48df6f': {
			os.alert({
				type: 'error',
				title: i18n.ts.loginFailed,
				text: i18n.ts.incorrectTotp,
			});
			break;
		}
		case '36b96a7d-b547-412d-aeed-2d611cdc8cdc': {
			os.alert({
				type: 'error',
				title: i18n.ts.loginFailed,
				text: i18n.ts.unknownWebAuthnKey,
			});
			break;
		}
		case '93b86c4b-72f9-40eb-9815-798928603d1e': {
			os.alert({
				type: 'error',
				title: i18n.ts.loginFailed,
				text: i18n.ts.passkeyVerificationFailed,
			});
			break;
		}
		case 'b18c89a7-5b5e-4cec-bb5b-0419f332d430': {
			os.alert({
				type: 'error',
				title: i18n.ts.loginFailed,
				text: i18n.ts.passkeyVerificationFailed,
			});
			break;
		}
		case '2d84773e-f7b7-4d0b-8f72-bb69b584c912': {
			os.alert({
				type: 'error',
				title: i18n.ts.loginFailed,
				text: i18n.ts.passkeyVerificationSucceededButPasswordlessLoginDisabled,
			});
			break;
		}
		default: {
			console.error(err);
			os.alert({
				type: 'error',
				title: i18n.ts.loginFailed,
				text: JSON.stringify(err),
			});
		}
	}

	inputPageEl.value?.resetCaptcha();

	window.fetch(`${authUrl}/signin`, {
		credentials: 'omit',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: '{}',
	}).then((res) => res.json() as Promise<Misskey.entities.SigninFlowInitResponse>).then((ssRes) => {
		signinSession.value = ssRes;
	}).catch(() => {
		signinSession.value = null;
	});

	nextTick(() => {
		waiting.value = false;
	});
}

onMounted(async () => {
	const ssRes = await window.fetch(`${authUrl}/signin`, {
		credentials: 'omit',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: '{}',
	}).then((res) => res.json() as Promise<Misskey.entities.SigninFlowInitResponse>).catch(() => null);

	if (ssRes != null) {
		signinSession.value = ssRes;

		// オートフィルのパスキーログインセッション
		if (await browserSupportsWebAuthnAutofill()) {
			startAuthentication({
				optionsJSON: ssRes.passkeyOptions,
				useBrowserAutofill: true,
			}).then(async (res) => {
				console.log('Got passkey credential from browser autofill', res);
				waiting.value = true;
				const ssPasskeyPwLessRes = await window.fetch(`${authUrl}/signin`, {
					credentials: 'omit',
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						sessionId: ssRes.sessionId,
						passkeyCredential: res,
					} satisfies Misskey.entities.SigninFlowContinueRequest),
				}).then(async (res) => {
					const json = await res.json() as Misskey.entities.SigninFlowResponse;
					if (res.ok) {
						return json;
					} else {
						onSigninApiError(json);
						return null;
					}
				}).catch((err) => {
					onSigninApiError(err);
					return null;
				});

				if (ssPasskeyPwLessRes != null && 'id' in ssPasskeyPwLessRes) {
					emit('login', ssPasskeyPwLessRes!);
					await onLoginSucceeded(ssPasskeyPwLessRes!);
				} else {
					waiting.value = false;
				}
			});
		}
	}
});

onBeforeUnmount(() => {
	password.value = '';
	userInfo.value = null;
});
</script>

<style lang="scss" module>
.transition_enterActive,
.transition_leaveActive {
	transition: opacity 0.3s cubic-bezier(0,0,.35,1), transform 0.3s cubic-bezier(0,0,.35,1);
}
.transition_enterFrom {
	opacity: 0;
	transform: translateX(50px);
}
.transition_leaveTo {
	opacity: 0;
	transform: translateX(-50px);
}

.signinRoot {
	overflow-x: hidden;
	overflow-x: clip;

	position: relative;
}

.waitingRoot {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	background-color: color-mix(in srgb, var(--MI_THEME-panel), transparent 50%);
	display: flex;
	justify-content: center;
	align-items: center;
	z-index: 1;
}
</style>
