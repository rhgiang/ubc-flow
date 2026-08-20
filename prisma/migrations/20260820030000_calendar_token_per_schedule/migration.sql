-- AlterTable
ALTER TABLE "CalendarToken" DROP COLUMN "userId",
ADD COLUMN     "scheduleId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CalendarToken_scheduleId_key" ON "CalendarToken"("scheduleId");

-- CreateIndex
CREATE INDEX "SavedSchedule_userId_idx" ON "SavedSchedule"("userId");

-- AddForeignKey
ALTER TABLE "SavedSchedule" ADD CONSTRAINT "SavedSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarToken" ADD CONSTRAINT "CalendarToken_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "SavedSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
