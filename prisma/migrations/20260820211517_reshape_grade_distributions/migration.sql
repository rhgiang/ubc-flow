-- AlterTable
ALTER TABLE "GradeDistribution" DROP COLUMN "instructorId",
ADD COLUMN     "detail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sectionCode" TEXT NOT NULL,
ALTER COLUMN "termId" SET NOT NULL,
ALTER COLUMN "termId" SET DEFAULT '';

-- CreateTable
CREATE TABLE "GradeDistributionInstructor" (
    "distributionId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,

    CONSTRAINT "GradeDistributionInstructor_pkey" PRIMARY KEY ("distributionId","instructorId")
);

-- CreateIndex
CREATE INDEX "GradeDistributionInstructor_instructorId_idx" ON "GradeDistributionInstructor"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeDistribution_courseId_termId_sectionCode_detail_key" ON "GradeDistribution"("courseId", "termId", "sectionCode", "detail");

-- AddForeignKey
ALTER TABLE "GradeDistribution" ADD CONSTRAINT "GradeDistribution_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeDistributionInstructor" ADD CONSTRAINT "GradeDistributionInstructor_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "GradeDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeDistributionInstructor" ADD CONSTRAINT "GradeDistributionInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
