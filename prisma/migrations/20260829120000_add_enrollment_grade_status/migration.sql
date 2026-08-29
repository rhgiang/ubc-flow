-- Completion, not just registration.
--
-- Enrollment recorded that a student signed up for a course and nothing about
-- how it went, so degree progress had to infer "passed" from the term having
-- ended — which is wrong for anyone who failed or withdrew. `grade` keeps
-- Workday's own value verbatim; `status` is what that means for a degree.
--
-- The default keeps every existing row at "registered", its old and honest
-- meaning, rather than promoting history nobody verified.
ALTER TABLE "Enrollment" ADD COLUMN "grade" TEXT;
ALTER TABLE "Enrollment" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'registered';

-- Transfer credit was previously dropped at import rather than stored. Rows
-- written before this used source='transfer' as the only marker.
UPDATE "Enrollment" SET "status" = 'transfer' WHERE "source" = 'transfer';
