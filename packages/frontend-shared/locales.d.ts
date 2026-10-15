/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Language } from 'i18n';
import type { Locale } from './js/autogen/locale.js';

export declare const localesDir: string;

export declare function loadFrontendLocales(): Record<Language, Locale>;
