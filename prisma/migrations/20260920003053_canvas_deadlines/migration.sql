-- CreateTable
CREATE TABLE "CanvasFeed" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedUrl" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFetchedAt" TIMESTAMP(3),
    "lastStatus" INTEGER,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "brokenAt" TIMESTAMP(3),
    "firstSyncedAt" TIMESTAMP(3),

    CONSTRAINT "CanvasFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasDeadline" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedFrom" TIMESTAMP(3),
    "movedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "CanvasDeadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderPreference" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "leadHours" INTEGER[] DEFAULT ARRAY[72, 24]::INTEGER[],
    "mutedCourses" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ReminderPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ReminderSent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deadlineId" TEXT NOT NULL,
    "notice" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "ReminderSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanvasFeed_userId_key" ON "CanvasFeed"("userId");

-- CreateIndex
CREATE INDEX "CanvasDeadline_userId_dueAt_idx" ON "CanvasDeadline"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasDeadline_userId_uid_key" ON "CanvasDeadline"("userId", "uid");

-- CreateIndex
CREATE INDEX "ReminderSent_userId_deliveredAt_idx" ON "ReminderSent"("userId", "deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSent_deadlineId_notice_key" ON "ReminderSent"("deadlineId", "notice");

-- AddForeignKey
ALTER TABLE "CanvasFeed" ADD CONSTRAINT "CanvasFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasDeadline" ADD CONSTRAINT "CanvasDeadline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderPreference" ADD CONSTRAINT "ReminderPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSent" ADD CONSTRAINT "ReminderSent_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "CanvasDeadline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
