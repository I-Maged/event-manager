-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "inviteToken" TEXT;

-- AlterTable
ALTER TABLE "RSVP" ADD COLUMN     "attendeeName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Event_inviteToken_key" ON "Event"("inviteToken");
