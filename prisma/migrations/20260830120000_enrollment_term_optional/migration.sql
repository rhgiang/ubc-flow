-- Academic-record exports list what you took and what you got, with no dates
-- and no sections, so those enrollments have no term to record. Widening the
-- column is safe: every existing row keeps its value.
ALTER TABLE "Enrollment" ALTER COLUMN "termId" DROP NOT NULL;
