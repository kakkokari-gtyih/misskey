/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { I18n } from 'i18n';
import type { BackendLocale } from '@/i18n/autogen/locale.js';

// 翻訳文は Crowdin 経由で入ってくるため、ユーザー入力と同様に信頼せず必ず safe を付けてエスケープすること

type ServerI18n = I18n<BackendLocale>;

export type EmailContent = {
	subject: string;
	html: string;
	text: string;
};

async function paragraphs(subject: string, lines: string[]): Promise<EmailContent> {
	return {
		subject,
		html: await (<>{lines.map(line => <p safe>{line}</p>)}</>),
		text: lines.join('\n\n'),
	};
}

async function withLink(subject: string, body: string, link: string): Promise<EmailContent> {
	return {
		subject,
		html: await (
			<>
				<p safe>{body}</p>
				<p><a href={link} safe>{link}</a></p>
			</>
		),
		text: `${body}\n${link}`,
	};
}

export function signupEmail(i18n: ServerI18n, link: string): Promise<EmailContent> {
	return withLink(i18n.ts._email._signup.subject, i18n.ts._email._signup.body, link);
}

export function resetPasswordEmail(i18n: ServerI18n, link: string): Promise<EmailContent> {
	return withLink(i18n.ts._email._resetPassword.subject, i18n.ts._email._resetPassword.body, link);
}

export function verifyEmailEmail(i18n: ServerI18n, link: string): Promise<EmailContent> {
	return withLink(i18n.ts._email._verifyEmail.subject, i18n.ts._email._verifyEmail.body, link);
}

export function newLoginEmail(i18n: ServerI18n): Promise<EmailContent> {
	return paragraphs(i18n.ts._email._newLogin.subject, [i18n.ts._email._newLogin.body]);
}

export function accountDeletedEmail(i18n: ServerI18n): Promise<EmailContent> {
	return paragraphs(i18n.ts._email._accountDeleted.subject, [i18n.ts._email._accountDeleted.body]);
}

/**
 * @param comment 通報の本文 (ユーザー入力)
 */
export function abuseReportEmail(i18n: ServerI18n, comment: string): Promise<EmailContent> {
	return paragraphs(i18n.ts._email._abuseReport.subject, [comment]);
}

export function moderatorInactivityWarningEmail(i18n: ServerI18n, remainingTime: { asDays: number; asHours: number; }): Promise<EmailContent> {
	const time = remainingTime.asDays === 0
		? i18n.tsx._time.hours({ n: remainingTime.asHours })
		: i18n.tsx._time.days({ n: remainingTime.asDays });

	return paragraphs(i18n.ts._email._moderatorInactivityWarning.subject, [
		i18n.ts._email.toModerators,
		i18n.tsx._email._moderatorInactivityWarning.body({ time }),
		i18n.ts._email._moderatorInactivityWarning.action,
	]);
}

export function invitationOnlyChangedEmail(i18n: ServerI18n, days: number): Promise<EmailContent> {
	return paragraphs(i18n.ts._email._invitationOnlyChanged.subject, [
		i18n.ts._email.toModerators,
		i18n.tsx._email._invitationOnlyChanged.body({ days }),
		i18n.ts._email._invitationOnlyChanged.action,
	]);
}
