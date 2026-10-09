-- Rename RVSPStatus -> RSVPStatus (fix typo) and add WAITLISTED, preserving data.
-- Prisma's default DROP COLUMN would lose existing RSVP rows, so cast instead.

-- CreateEnum
CREATE TYPE "RSVPStatus" AS ENUM ('GOING', 'NOT_GOING', 'MAYBE', 'WAITLISTED');

-- AlterTable (cast preserves existing values; old labels are unchanged)
ALTER TABLE "RSVP" ALTER COLUMN "status" TYPE "RSVPStatus" USING "status"::text::"RSVPStatus";

-- DropEnum
DROP TYPE "RVSPStatus";

-- CreateIndex
CREATE INDEX "RSVP_eventId_idx" ON "RSVP"("eventId");
