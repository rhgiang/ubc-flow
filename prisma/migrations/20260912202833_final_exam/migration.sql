-- CreateTable
CREATE TABLE "FinalExam" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "sectionCode" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "startTime" TEXT,
    "alphaSplit" TEXT,
    "building" TEXT,
    "room" TEXT,
    "notes" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FinalExam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinalExam_termId_idx" ON "FinalExam"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalExam_courseId_termId_sectionCode_alphaSplit_key" ON "FinalExam"("courseId", "termId", "sectionCode", "alphaSplit");
