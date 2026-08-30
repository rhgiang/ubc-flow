-- CreateTable
CREATE TABLE "EnrollmentShareToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentShareToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentShareToken_token_key" ON "EnrollmentShareToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentShareToken_userId_termId_key" ON "EnrollmentShareToken"("userId", "termId");

-- AddForeignKey
ALTER TABLE "EnrollmentShareToken" ADD CONSTRAINT "EnrollmentShareToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
