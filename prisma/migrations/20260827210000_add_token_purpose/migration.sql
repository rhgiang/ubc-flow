-- AlterTable
ALTER TABLE "VerificationToken" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'verify';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VerificationToken_userId_purpose_idx" ON "VerificationToken"("userId", "purpose");
