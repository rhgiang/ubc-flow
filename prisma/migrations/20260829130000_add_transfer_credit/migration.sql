-- Credit earned at another institution.
--
-- It cannot go in Enrollment, which is keyed on a UBC term: transfer credit
-- has no term, and often no course either — a Workday record lists rows like
-- "PHYS_V 1ST", unassigned first-year credit in a subject rather than a
-- specific course. Those still count toward a degree total, so courseId is
-- nullable and `raw` always holds what Workday actually said.
--
-- Keeping it out of Enrollment is also what stops it granting review rights:
-- the review gate reads Enrollment and never sees these rows.
CREATE TABLE "TransferCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "raw" TEXT NOT NULL,
    "credits" DOUBLE PRECISION,
    CONSTRAINT "TransferCredit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransferCredit_userId_raw_key" ON "TransferCredit"("userId", "raw");
CREATE INDEX "TransferCredit_userId_idx" ON "TransferCredit"("userId");

ALTER TABLE "TransferCredit" ADD CONSTRAINT "TransferCredit_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransferCredit" ADD CONSTRAINT "TransferCredit_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
