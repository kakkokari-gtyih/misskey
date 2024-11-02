/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class PageVersion1730538170313 {
	name = 'PageVersion1730538170313'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "page" ADD "version" integer NOT NULL DEFAULT '2'`);
		// 現在あるページはすべてv1
		await queryRunner.query(`UPDATE "page" SET "version" = 1`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "page" DROP COLUMN "version"`);
	}
}
