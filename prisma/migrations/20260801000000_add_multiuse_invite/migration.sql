-- Multi-use "league invite" support (#110): reusable code the whole league joins
-- with, plus guard rails (usage cap + disable). Additive, no data migration.

-- DropIndex: allow many users to share one multi-use code (FK stays, uniqueness goes).
DROP INDEX "User_inviteCodeUsed_key";

-- AlterTable
ALTER TABLE "InviteCode" ADD COLUMN     "multiUse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxUses" INTEGER,
ADD COLUMN     "disabled" BOOLEAN NOT NULL DEFAULT false;
