/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const notificationRecieveConfig = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			nullable: false,
			properties: {
				type: {
					type: 'string',
					nullable: false,
					enum: ['all', 'following', 'follower', 'mutualFollow', 'followingOrFollower', 'never'],
				},
			},
			required: ['type'],
		},
		{
			type: 'object',
			nullable: false,
			properties: {
				type: {
					type: 'string',
					nullable: false,
					enum: ['list'],
				},
				userListId: {
					type: 'string',
					format: 'misskey:id',
				},
			},
			required: ['type', 'userListId'],
		},
	],
} as const;
