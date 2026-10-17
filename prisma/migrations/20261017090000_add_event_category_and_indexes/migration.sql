-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('MUSIC', 'SPORTS', 'TECH', 'ARTS', 'FOOD', 'WELLNESS', 'COMMUNITY', 'BUSINESS', 'EDUCATION', 'OTHER');

-- DropIndex
DROP INDEX "Event_userId_idx";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "category" "EventCategory" NOT NULL DEFAULT 'OTHER';

-- CreateIndex
CREATE INDEX "Event_userId_date_idx" ON "Event"("userId", "date");

-- CreateIndex
CREATE INDEX "Event_isPublic_date_idx" ON "Event"("isPublic", "date");

-- CreateIndex
CREATE INDEX "Event_category_date_idx" ON "Event"("category", "date");
