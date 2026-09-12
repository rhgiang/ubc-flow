-- AlterTable
ALTER TABLE "User" ADD COLUMN     "uploadCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "uploadWindowStart" TIMESTAMP(3);
