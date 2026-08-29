-- Read-only web sharing for a saved schedule. Nullable: null means not
-- shared, which is the default. Separate from CalendarToken on purpose —
-- revoking a share link must not break a calendar someone has subscribed.
ALTER TABLE "SavedSchedule" ADD COLUMN "shareToken" TEXT;

CREATE UNIQUE INDEX "SavedSchedule_shareToken_key" ON "SavedSchedule"("shareToken");
