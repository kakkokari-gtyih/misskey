/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as v from 'valibot';
import * as mi from '@/misc/schema/index.js';

export type PackedRoleCondFormulaValueIsLocalOrRemote = v.InferOutput<typeof packedRoleCondFormulaValueIsLocalOrRemoteSchema>;
export type PackedRoleCondFormulaValueUserSettingBoolean = v.InferOutput<typeof packedRoleCondFormulaValueUserSettingBooleanSchema>;
export type PackedRoleCondFormulaValueAssignedRole = v.InferOutput<typeof packedRoleCondFormulaValueAssignedRoleSchema>;
export type PackedRoleCondFormulaValueCreated = v.InferOutput<typeof packedRoleCondFormulaValueCreatedSchema>;
export type PackedRoleCondFormulaFollowersOrFollowingOrNotes = v.InferOutput<typeof packedRoleCondFormulaFollowersOrFollowingOrNotesSchema>;

/**
 * `RoleCondFormulaLogics.values` / `RoleCondFormulaValueNot.value` が自分自身
 * (`RoleCondFormulaValue`) を含む循環スキーマなので、出力型を手書きして
 * `v.GenericSchema<...>` で明示注釈する (cookbook R13)。
 */
export type PackedRoleCondFormulaLogics = {
	id: string;
	type: 'and' | 'or';
	values: PackedRoleCondFormulaValue[];
};

export type PackedRoleCondFormulaValueNot = {
	id: string;
	type: 'not';
	value: PackedRoleCondFormulaValue;
};

export type PackedRoleCondFormulaValue =
	| PackedRoleCondFormulaLogics
	| PackedRoleCondFormulaValueNot
	| PackedRoleCondFormulaValueIsLocalOrRemote
	| PackedRoleCondFormulaValueUserSettingBoolean
	| PackedRoleCondFormulaValueAssignedRole
	| PackedRoleCondFormulaValueCreated
	| PackedRoleCondFormulaFollowersOrFollowingOrNotes;

export const packedRoleCondFormulaLogicsSchema = v.object({
	id: v.string(),
	type: v.picklist(['and', 'or']),
	values: v.array(v.lazy((): v.GenericSchema<PackedRoleCondFormulaValue> => packedRoleCondFormulaValueSchema)),
});
mi.defineEntity('RoleCondFormulaLogics', packedRoleCondFormulaLogicsSchema);

export const packedRoleCondFormulaValueNot = v.object({
	id: v.string(),
	type: v.literal('not'),
	value: v.lazy((): v.GenericSchema<PackedRoleCondFormulaValue> => packedRoleCondFormulaValueSchema),
});
mi.defineEntity('RoleCondFormulaValueNot', packedRoleCondFormulaValueNot);

export const packedRoleCondFormulaValueIsLocalOrRemoteSchema = v.object({
	id: v.string(),
	type: v.picklist(['isLocal', 'isRemote']),
});
mi.defineEntity('RoleCondFormulaValueIsLocalOrRemote', packedRoleCondFormulaValueIsLocalOrRemoteSchema);

export const packedRoleCondFormulaValueUserSettingBooleanSchema = v.object({
	id: v.string(),
	type: v.picklist(['isSuspended', 'isLocked', 'isBot', 'isCat', 'isExplorable']),
});
mi.defineEntity('RoleCondFormulaValueUserSettingBooleanSchema', packedRoleCondFormulaValueUserSettingBooleanSchema);

export const packedRoleCondFormulaValueAssignedRoleSchema = v.object({
	id: v.string(),
	type: v.literal('roleAssignedTo'),
	roleId: mi.example(mi.idString(), 'xxxxxxxxxx'),
});
mi.defineEntity('RoleCondFormulaValueAssignedRole', packedRoleCondFormulaValueAssignedRoleSchema);

export const packedRoleCondFormulaValueCreatedSchema = v.object({
	id: v.string(),
	type: v.picklist([
		'createdLessThan',
		'createdMoreThan',
	]),
	sec: v.number(),
});
mi.defineEntity('RoleCondFormulaValueCreated', packedRoleCondFormulaValueCreatedSchema);

export const packedRoleCondFormulaFollowersOrFollowingOrNotesSchema = v.object({
	id: v.string(),
	type: v.picklist([
		'followersLessThanOrEq',
		'followersMoreThanOrEq',
		'followingLessThanOrEq',
		'followingMoreThanOrEq',
		'notesLessThanOrEq',
		'notesMoreThanOrEq',
	]),
	value: v.number(),
});
mi.defineEntity('RoleCondFormulaFollowersOrFollowingOrNotes', packedRoleCondFormulaFollowersOrFollowingOrNotesSchema);

// 判別キー `type` を持つ oneOf なので `v.variant` (cookbook R10)
export const packedRoleCondFormulaValueSchema: v.GenericSchema<PackedRoleCondFormulaValue> = v.variant('type', [
	packedRoleCondFormulaLogicsSchema,
	packedRoleCondFormulaValueNot,
	packedRoleCondFormulaValueIsLocalOrRemoteSchema,
	packedRoleCondFormulaValueUserSettingBooleanSchema,
	packedRoleCondFormulaValueAssignedRoleSchema,
	packedRoleCondFormulaValueCreatedSchema,
	packedRoleCondFormulaFollowersOrFollowingOrNotesSchema,
]);
mi.defineEntity('RoleCondFormulaValue', packedRoleCondFormulaValueSchema);

export const packedRoleLiteSchema = v.object({
	id: mi.example(mi.idString(), 'xxxxxxxxxx'),
	name: mi.example(v.string(), 'New Role'),
	color: mi.example(v.nullable(v.string()), '#000000'),
	iconUrl: v.nullable(v.string()),
	description: v.string(),
	isModerator: mi.example(v.boolean(), false),
	isAdministrator: mi.example(v.boolean(), false),
	displayOrder: mi.example(mi.integer(), 0),
});
mi.defineEntity('RoleLite', packedRoleLiteSchema);

export type PackedRoleLite = v.InferOutput<typeof packedRoleLiteSchema>;

export const packedRolePoliciesSchema = v.object({
	gtlAvailable: v.boolean(),
	ltlAvailable: v.boolean(),
	canPublicNote: v.boolean(),
	mentionLimit: mi.integer(),
	canInvite: v.boolean(),
	inviteLimit: mi.integer(),
	inviteLimitCycle: mi.integer(),
	inviteExpirationTime: mi.integer(),
	canManageCustomEmojis: v.boolean(),
	canManageAvatarDecorations: v.boolean(),
	canSearchNotes: v.boolean(),
	canSearchUsers: v.boolean(),
	canUseTranslator: v.boolean(),
	canHideAds: v.boolean(),
	canCreateChannel: v.boolean(),
	driveCapacityMb: mi.integer(),
	maxFileSizeMb: mi.integer(),
	uploadableFileTypes: v.array(v.string()),
	alwaysMarkNsfw: v.boolean(),
	canUpdateBioMedia: v.boolean(),
	pinLimit: mi.integer(),
	antennaLimit: mi.integer(),
	wordMuteLimit: mi.integer(),
	webhookLimit: mi.integer(),
	clipLimit: mi.integer(),
	noteEachClipsLimit: mi.integer(),
	userListLimit: mi.integer(),
	userEachUserListsLimit: mi.integer(),
	rateLimitFactor: mi.integer(),
	avatarDecorationLimit: mi.integer(),
	canImportAntennas: v.boolean(),
	canImportBlocking: v.boolean(),
	canImportFollowing: v.boolean(),
	canImportMuting: v.boolean(),
	canImportUserLists: v.boolean(),
	chatAvailability: v.picklist(['available', 'readonly', 'unavailable']),
	noteDraftLimit: mi.integer(),
	scheduledNoteLimit: mi.integer(),
	watermarkAvailable: v.boolean(),
});
mi.defineEntity('RolePolicies', packedRolePoliciesSchema);

export type PackedRolePolicies = v.InferOutput<typeof packedRolePoliciesSchema>;
