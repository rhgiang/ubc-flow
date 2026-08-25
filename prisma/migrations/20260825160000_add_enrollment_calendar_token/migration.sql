-- CreateTable
CREATE TABLE "EnrollmentCalendarToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentCalendarToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentCalendarToken_token_key" ON "EnrollmentCalendarToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentCalendarToken_userId_termId_key" ON "EnrollmentCalendarToken"("userId", "termId");

-- AddForeignKey
ALTER TABLE "EnrollmentCalendarToken" ADD CONSTRAINT "EnrollmentCalendarToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
