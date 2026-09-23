-- Grandfather every existing account before sign-in starts requiring a
-- verified address.
--
-- Until now nothing checked emailVerified, so credentials accounts have it
-- NULL whether or not the person ever clicked the link, and for three weeks
-- the verification email was undeliverable anyway (MAIL_FROM was Resend's
-- sandbox sender). Enforcing without this would lock out every existing user
-- over a link most of them never received.
--
-- Stamped with the account's own creation time rather than now(), so the
-- column keeps meaning "when we accepted this address" instead of "when we
-- ran this migration". Only fills nulls: a genuinely verified account keeps
-- the instant it actually verified.
UPDATE "User"
SET "emailVerified" = "createdAt"
WHERE "emailVerified" IS NULL;
