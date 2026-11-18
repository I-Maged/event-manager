-- CreateTable
CREATE TABLE "CopilotAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT,
    "input" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "rawOutput" TEXT,
    "suggestion" JSONB,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopilotAudit_userId_createdAt_idx" ON "CopilotAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotAudit_eventId_idx" ON "CopilotAudit"("eventId");

-- AddForeignKey
ALTER TABLE "CopilotAudit" ADD CONSTRAINT "CopilotAudit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
