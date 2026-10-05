-- CreateTable
CREATE TABLE "ErrorAlert" (
    "key" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "suppressed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ErrorAlert_pkey" PRIMARY KEY ("key")
);
