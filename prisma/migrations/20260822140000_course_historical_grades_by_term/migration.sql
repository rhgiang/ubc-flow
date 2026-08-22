-- CreateTable
CREATE TABLE "CourseHistoricalGradesByTerm" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "session" TEXT NOT NULL,
    "average" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseHistoricalGradesByTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseHistoricalGradesByTerm_courseId_idx" ON "CourseHistoricalGradesByTerm"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseHistoricalGradesByTerm_courseId_year_session_key" ON "CourseHistoricalGradesByTerm"("courseId", "year", "session");

-- AddForeignKey
ALTER TABLE "CourseHistoricalGradesByTerm" ADD CONSTRAINT "CourseHistoricalGradesByTerm_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
