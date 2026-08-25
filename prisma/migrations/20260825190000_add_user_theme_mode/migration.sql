-- AlterTable
-- IF NOT EXISTS so re-running against a database where the column was already
-- added by hand is a no-op rather than a hard failure.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeMode" TEXT;
