-- AlterTable
ALTER TABLE "RSVP" ADD COLUMN     "checkedInBy" TEXT;

-- CreateIndex
CREATE INDEX "RSVP_eventId_status_createdAt_idx" ON "RSVP"("eventId", "status", "createdAt");

-- CHECK constraints (not representable in Prisma schema)
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_maxAttendees_positive"
  CHECK ("maxAttendees" IS NULL OR "maxAttendees" > 0);

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_body_length"
  CHECK (char_length("body") <= 1000);
