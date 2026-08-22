-- CreateTable
CREATE TABLE "EnrollmentMeeting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "sectionCode" TEXT,
    "activity" TEXT,
    "days" TEXT[],
    "startTime" TEXT,
    "endTime" TEXT,

    CONSTRAINT "EnrollmentMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrollmentMeeting_userId_termId_idx" ON "EnrollmentMeeting"("userId", "termId");

-- AddForeignKey
ALTER TABLE "EnrollmentMeeting" ADD CONSTRAINT "EnrollmentMeeting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
