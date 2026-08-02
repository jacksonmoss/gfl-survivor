-- Season-scope team-trophy rosters (#120).
-- Roster membership moves from a single global `User.teamId` pointer to a
-- per-(user, season) `TeamMembership` join table so past seasons keep the
-- rosters they actually had. `Team` stays a persistent entity.

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamMembership_seasonId_idx" ON "TeamMembership"("seasonId");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_idx" ON "TeamMembership"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_userId_seasonId_key" ON "TeamMembership"("userId", "seasonId");

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: preserve today's rosters by cloning each user's existing
-- `User.teamId` into a membership for the current active season. Runs BEFORE
-- the column is dropped. If there is no active season, nothing is copied.
INSERT INTO "TeamMembership" ("id", "userId", "seasonId", "teamId")
SELECT gen_random_uuid()::text, u."id", s."id", u."teamId"
FROM "User" u
CROSS JOIN (
    SELECT "id" FROM "Season" WHERE "isActive" = true ORDER BY "year" DESC LIMIT 1
) s
WHERE u."teamId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_teamId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "teamId";
