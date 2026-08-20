-- AlterTable
ALTER TABLE "CourseReview" DROP COLUMN "instructorId";

-- AlterTable
ALTER TABLE "InstructorReview" ALTER COLUMN "courseId" SET NOT NULL;
