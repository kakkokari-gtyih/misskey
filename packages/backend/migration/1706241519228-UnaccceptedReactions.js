/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class UnaccceptedReactions1706241519228 {
	name = 'UnaccceptedReactions1706241519228'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_profile" ADD "unacceptedReactions" character varying(260) array NOT NULL DEFAULT '{}'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "unacceptedReactions"`);
	}
}
