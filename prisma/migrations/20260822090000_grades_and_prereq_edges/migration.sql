-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "antireqCodes" JSONB;

-- CreateTable
CREATE TABLE "CourseHistoricalGrades" (
    "courseId" TEXT NOT NULL,
    "average" DOUBLE PRECISION,
    "averagePast5Years" DOUBLE PRECISION,
    "minSectionAverage" DOUBLE PRECISION,
    "maxSectionAverage" DOUBLE PRECISION,
    "stddev" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseHistoricalGrades_pkey" PRIMARY KEY ("courseId")
);

-- CreateTable
CREATE TABLE "CoursePrereqEdge" (
    "courseId" TEXT NOT NULL,
    "requiredCourseId" TEXT NOT NULL,

    CONSTRAINT "CoursePrereqEdge_pkey" PRIMARY KEY ("courseId","requiredCourseId")
);

-- CreateIndex
CREATE INDEX "CoursePrereqEdge_requiredCourseId_idx" ON "CoursePrereqEdge"("requiredCourseId");

-- AddForeignKey
ALTER TABLE "CourseHistoricalGrades" ADD CONSTRAINT "CourseHistoricalGrades_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePrereqEdge" ADD CONSTRAINT "CoursePrereqEdge_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePrereqEdge" ADD CONSTRAINT "CoursePrereqEdge_requiredCourseId_fkey" FOREIGN KEY ("requiredCourseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
