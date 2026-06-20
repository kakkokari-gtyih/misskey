/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class RefreshToken1781942255625 {
    name = 'RefreshToken1781942255625'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "signin" ADD "refreshToken" character varying(128)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_23cccabb9e7b10b0581c8aebe4" ON "signin" ("refreshToken") WHERE "refreshToken" IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_23cccabb9e7b10b0581c8aebe4"`);
        await queryRunner.query(`ALTER TABLE "signin" DROP COLUMN "refreshToken"`);
    }
}
