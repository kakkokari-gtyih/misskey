/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

function isIgnorableErrorMessage(message: string): boolean {
	return [
		'The source image cannot be decoded',
		'ResizeObserver loop limit exceeded',
		'ResizeObserver loop completed with undelivered notifications',
	].some((text) => message.includes(text));
}

window.addEventListener('error', (event) => {
	if (isIgnorableErrorMessage(event.message)) {
		event.preventDefault();
	}
});

window.addEventListener('unhandledrejection', (event) => {
	const reason = event.reason;
	const message = reason instanceof Error ? reason.message : String(reason);
	if (isIgnorableErrorMessage(message)) {
		event.preventDefault();
	}
});
