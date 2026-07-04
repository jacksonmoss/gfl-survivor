-- CreateEnum
CREATE TYPE "ReminderSlot" AS ENUM ('THURSDAY', 'SUNDAY', 'PLAYOFF');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailReminders" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "slot" "ReminderSlot" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReminderLog_weekId_idx" ON "ReminderLog"("weekId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_userId_weekId_slot_key" ON "ReminderLog"("userId", "weekId", "slot");

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;
