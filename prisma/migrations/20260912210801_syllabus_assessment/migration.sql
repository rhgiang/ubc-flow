-- AlterTable
ALTER TABLE "Syllabus" ADD COLUMN     "extractedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extractionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extractionWindowStart" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SyllabusAssessment" (
    "id" TEXT NOT NULL,
    "syllabusId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "startTime" TEXT,
    "weight" DOUBLE PRECISION,
    "quote" TEXT,
    "page" INTEGER,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SyllabusAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyllabusAssessment_syllabusId_idx" ON "SyllabusAssessment"("syllabusId");

-- AddForeignKey
ALTER TABLE "SyllabusAssessment" ADD CONSTRAINT "SyllabusAssessment_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES "Syllabus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
