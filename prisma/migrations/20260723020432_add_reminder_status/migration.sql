-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "ReminderLog" ADD COLUMN     "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill: pre-existing rows were created only after a successful send (the old
-- claim-on-send model had no failure state), so treat them all as delivered.
-- New rows insert as PENDING (the column default) and transition to SENT/FAILED.
UPDATE "ReminderLog" SET "status" = 'SENT';
