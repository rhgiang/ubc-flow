-- An assessment used to reach its student only through its syllabus, so an
-- exam for a course with no syllabus had no parent to hang off. It carries its
-- own owner now. Existing rows are backfilled from the syllabus they belong
-- to, never orphaned, which is why the three columns arrive nullable and are
-- tightened afterwards.

-- AlterTable
ALTER TABLE "SyllabusAssessment" ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "termId" TEXT,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "syllabusId" DROP NOT NULL;

-- Backfill from the parent syllabus. Every row has one at this point:
-- syllabusId was NOT NULL until the statement above.
UPDATE "SyllabusAssessment" AS a
SET "userId" = s."userId", "courseId" = s."courseId", "termId" = s."termId"
FROM "Syllabus" AS s
WHERE a."syllabusId" = s."id";

ALTER TABLE "SyllabusAssessment" ALTER COLUMN "courseId" SET NOT NULL,
ALTER COLUMN "termId" SET NOT NULL,
ALTER COLUMN "userId" SET NOT NULL;

-- CreateTable
CREATE TABLE "HiddenFinalExam" (
    "userId" TEXT NOT NULL,
    "finalExamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenFinalExam_pkey" PRIMARY KEY ("userId","finalExamId")
);

-- CreateIndex
CREATE INDEX "SyllabusAssessment_userId_termId_idx" ON "SyllabusAssessment"("userId", "termId");

-- AddForeignKey
ALTER TABLE "SyllabusAssessment" ADD CONSTRAINT "SyllabusAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenFinalExam" ADD CONSTRAINT "HiddenFinalExam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
