/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const blockBaseSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
		},
		type: {
			type: 'string',
			optional: false, nullable: false,
		},
	},
} as const;

const textBlockSchema = {
	type: 'object',
	properties: {
		...blockBaseSchema.properties,
		type: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['text'],
		},
		text: {
			type: 'string',
			optional: false, nullable: false,
		},
	},
} as const;

const sectionBlockSchema = {
	type: 'object',
	properties: {
		...blockBaseSchema.properties,
		type: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['section'],
		},
		title: {
			type: 'string',
			optional: false, nullable: false,
		},
		children: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'PageBlock',
				selfRef: true,
			},
		},
	},
} as const;

const imageBlockSchema = {
	type: 'object',
	properties: {
		...blockBaseSchema.properties,
		type: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['image'],
		},
		fileId: {
			type: 'string',
			optional: false, nullable: true,
		},
	},
} as const;

const noteBlockSchema = {
	type: 'object',
	properties: {
		...blockBaseSchema.properties,
		type: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['note'],
		},
		detailed: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		note: {
			type: 'string',
			optional: false, nullable: true,
		},
	},
} as const;

export const packedPageBlockV1Schema = {
	type: 'object',
	oneOf: [
		textBlockSchema,
		sectionBlockSchema,
		imageBlockSchema,
		noteBlockSchema,
	],
} as const;

const headingBlockSchema = {
	type: 'object',
	properties: {
		...blockBaseSchema.properties,
		type: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['heading'],
		},
		level: {
			type: 'number',
			optional: false, nullable: false,
		},
		text: {
			type: 'string',
			optional: false, nullable: false,
		},
	},
} as const;

const filesBlockSchema = {
	type: 'object',
	properties: {
		...blockBaseSchema.properties,
		type: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['files'],
		},
		fileIds: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},
} as const;

const bookBlockSchema = {
	type: 'object',
	properties: {
		...blockBaseSchema.properties,
		type: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['book'],
		},
		binding: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['left', 'right'],
		},
		fileIds: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},
} as const;

export const packedPageBlockV2Schema = {
	type: 'object',
	oneOf: [
		textBlockSchema,
		headingBlockSchema,
		noteBlockSchema,
		filesBlockSchema,
		bookBlockSchema,
	],
} as const;

export const packedPageBlockSchema = {
	type: 'object',
	oneOf: [{
		ref: 'PageBlockV1',
	}, {
		ref: 'PageBlockV2',
	}],
} as const;

const packedPageBaseSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
			example: 'xxxxxxxxxx',
		},
		version: {
			type: 'number',
			optional: false, nullable: false,
			enum: [1, 2],
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		updatedAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		userId: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		user: {
			type: 'object',
			ref: 'UserLite',
			optional: false, nullable: false,
		},
		title: {
			type: 'string',
			optional: false, nullable: false,
		},
		name: {
			type: 'string',
			optional: false, nullable: false,
		},
		summary: {
			type: 'string',
			optional: false, nullable: true,
		},
		eyeCatchingImageId: {
			type: 'string',
			optional: false, nullable: true,
		},
		eyeCatchingImage: {
			type: 'object',
			optional: false, nullable: true,
			ref: 'DriveFile',
		},
		attachedFiles: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'DriveFile',
			},
		},
		likedCount: {
			type: 'number',
			optional: false, nullable: false,
		},
		isLiked: {
			type: 'boolean',
			optional: true, nullable: false,
		},
	},
} as const;

export const packedPageV1Schema = {
	type: 'object',
	properties: {
		...packedPageBaseSchema.properties,
		version: {
			type: 'number',
			optional: false, nullable: false,
			enum: [1],
		},
		content: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'PageBlockV1',
			},
		},
		variables: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
			},
		},
		hideTitleWhenPinned: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		alignCenter: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		font: {
			type: 'string',
			optional: false, nullable: false,
		},
		script: {
			type: 'string',
			optional: false, nullable: false,
		},
	},
} as const;

export const packedPageV2Schema = {
	type: 'object',
	properties: {
		...packedPageBaseSchema.properties,
		version: {
			type: 'number',
			optional: false, nullable: false,
			enum: [2],
		},
		content: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'PageBlockV2',
			},
		},
	},
} as const;

export const packedPageSchema = {
	type: 'object',
	oneOf: [{
		ref: 'PageV1',
	}, {
		ref: 'PageV2',
	}],
} as const;
