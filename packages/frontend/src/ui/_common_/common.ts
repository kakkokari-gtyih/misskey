/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineAsyncComponent } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import * as os from '@/os.js';
import { instance } from '@/instance.js';
import { host } from '@/config.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/account.js';

function toolsMenuItems(): MenuItem[] {
	return [{
		type: 'link',
		to: '/scratchpad',
		text: i18n.ts.scratchpad,
		icon: 'ti ti-terminal-2',
	}, {
		type: 'link',
		to: '/api-console',
		text: 'API Console',
		icon: 'ti ti-terminal-2',
	}, {
		type: 'link',
		to: '/clicker',
		text: '🍪👈',
		icon: 'ti ti-cookie',
	}, ($i && ($i.isAdmin || $i.policies.canManageCustomEmojis)) ? {
		type: 'link',
		to: '/custom-emojis-manager',
		text: i18n.ts.manageCustomEmojis,
		icon: 'ti ti-icons',
	} : undefined, ($i && ($i.isAdmin || $i.policies.canManageAvatarDecorations)) ? {
		type: 'link',
		to: '/avatar-decorations',
		text: i18n.ts.manageAvatarDecorations,
		icon: 'ti ti-sparkles',
	} : undefined];
}

export function openInstanceMenu(ev: MouseEvent, compact = false) {
	const commonMenuItems: MenuItem[] = [(instance.impressumUrl) ? {
		type: 'a',
		target: '_blank',
		href: instance.impressumUrl,
		text: i18n.ts.impressum,
		icon: 'ti ti-file-invoice',
	} : undefined, (instance.tosUrl) ? {
		type: 'a',
		target: '_blank',
		href: instance.tosUrl,
		text: i18n.ts.termsOfService,
		icon: 'ti ti-notebook',
	} : undefined, (instance.privacyPolicyUrl) ? {
		type: 'a',
		target: '_blank',
		href: instance.privacyPolicyUrl,
		text: i18n.ts.privacyPolicy,
		icon: 'ti ti-shield-lock',
	} : undefined, {
		type: 'link',
		text: i18n.ts.inquiry,
		icon: 'ti ti-help-circle',
		to: '/contact',
	}, { type: 'divider' }, {
		type: 'a',
		target: '_blank',
		href: 'https://misskey-hub.net/docs/for-users/',
		text: i18n.ts.document,
		icon: 'ti ti-bulb',
	}];

	let menuItems: MenuItem[] = [];

	if (compact) {
		menuItems = [{
			type: 'link',
			text: i18n.ts.instanceInfo,
			icon: 'ti ti-info-circle',
			to: '/about',
		}, {
			type: 'link',
			text: i18n.ts.aboutMisskey,
			to: '/about-misskey',
		}, { type: 'divider' }, ...commonMenuItems];
	} else {
		menuItems = [{
			text: instance.name ?? host,
			type: 'label',
		}, {
			type: 'link',
			text: i18n.ts.instanceInfo,
			icon: 'ti ti-info-circle',
			to: '/about',
		}, {
			type: 'link',
			text: i18n.ts.customEmojis,
			icon: 'ti ti-icons',
			to: '/about#emojis',
		}, {
			type: 'link',
			text: i18n.ts.federation,
			icon: 'ti ti-whirl',
			to: '/about#federation',
		}, {
			type: 'link',
			text: i18n.ts.charts,
			icon: 'ti ti-chart-line',
			to: '/about#charts',
		}, { type: 'divider' }, {
			type: 'link',
			text: i18n.ts.ads,
			icon: 'ti ti-ad',
			to: '/ads',
		}, ($i && ($i.isAdmin === true || $i.policies.canInvite) && instance.disableRegistration) ? {
			type: 'link',
			to: '/invite',
			text: i18n.ts.invite,
			icon: 'ti ti-user-plus',
		} : undefined, {
			type: 'parent',
			text: i18n.ts.tools,
			icon: 'ti ti-tool',
			children: toolsMenuItems(),
		}, { type: 'divider' }, ...commonMenuItems, ($i) ? {
			text: i18n.ts._initialTutorial.launchTutorial,
			icon: 'ti ti-presentation',
			action: () => {
				os.popup(defineAsyncComponent(() => import('@/components/MkTutorialDialog.vue')), {}, {}, 'closed');
			},
		} : undefined, {
			type: 'link',
			text: i18n.ts.aboutMisskey,
			to: '/about-misskey',
		}];
	}

	os.popupMenu(menuItems, ev.currentTarget ?? ev.target, {
		align: 'left',
	});
}

export function openToolsMenu(ev: MouseEvent) {
	os.popupMenu(toolsMenuItems(), ev.currentTarget ?? ev.target, {
		align: 'left',
	});
}
