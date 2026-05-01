/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { ref } from 'vue';
import { apiUrl } from '@@/js/config.js';
import { $i } from '@/i.js';
import { refreshCurrentAccountToken } from '@/accounts.js';

export const pendingApiRequestsCount = ref(0);

// Implements Misskey.api.ApiClient.request
export async function misskeyApi<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data: P & { i?: string | null; } = {} as any,
	token?: string | null | undefined,
	signal?: AbortSignal,
	refreshTokenIfNeeded = true,
): Promise<_ResT> {
	if (endpoint.includes('://')) throw new Error('invalid endpoint');

	pendingApiRequestsCount.value++;

	let resBody: _ResT;
	let error: any = null;

	try {
		// Append a credential
		if ($i) data.i = $i.token.accessToken;
		if (token !== undefined) data.i = token;

		// Send request
		const res = await window.fetch(`${apiUrl}/${endpoint}`, {
			method: 'POST',
			body: JSON.stringify(data),
			credentials: 'omit',
			cache: 'no-cache',
			headers: {
				'Content-Type': 'application/json',
			},
			signal,
		});

		const body = res.status === 204 ? null : await res.json();

		// Token expired
		if (token === undefined && $i != null && refreshTokenIfNeeded && body?.error?.id === 'b0a7f5f8-dc2f-4171-b91f-de88ad238e14') {
			await refreshCurrentAccountToken();
			// Retry once with new token
			return misskeyApi(endpoint, data, $i?.token.accessToken ?? null, signal, false);
		}

		if (res.status === 200) {
			resBody = body;
		} else if (res.status === 204) {
			resBody = undefined as _ResT; // void -> undefined
		} else {
			error = Promise.reject(body.error);
		}
	} catch (err) {
		error = Promise.reject(err);
	} finally {
		pendingApiRequestsCount.value--;
	}

	if (error) return Promise.reject(error);

	return resBody!;
}

// Implements Misskey.api.ApiClient.request
export function misskeyApiGet<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data: P = {} as any,
): Promise<_ResT> {
	pendingApiRequestsCount.value++;

	const onFinally = () => {
		pendingApiRequestsCount.value--;
	};

	const query = new URLSearchParams(data as any);

	const promise = new Promise<_ResT>((resolve, reject) => {
		// Send request
		window.fetch(`${apiUrl}/${endpoint}?${query}`, {
			method: 'GET',
			credentials: 'omit',
			cache: 'default',
		}).then(async (res) => {
			const body = res.status === 204 ? null : await res.json();

			if (res.status === 200) {
				resolve(body);
			} else if (res.status === 204) {
				resolve(undefined as _ResT); // void -> undefined
			} else {
				reject(body.error);
			}
		}).catch(reject);
	});

	promise.then(onFinally, onFinally);

	return promise;
}
