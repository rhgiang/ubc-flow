'use client';

import CalendarSubscribeMenu from '@/components/schedule/CalendarSubscribeMenu';
import ShareLinkMenu from '@/components/schedule/ShareLinkMenu';
import {
  getSubscribeUrl,
  enableScheduleSharing,
  disableScheduleSharing,
} from '@/app/actions/schedule';
import ScheduleSwitcher, { type ScheduleOption } from '@/components/schedule/ScheduleSwitcher';

export default function ScheduleHeader({
  name,
  onNameChange,
  termId,
  onTermChange,
  terms,
  scheduleId,
  shareToken = null,
  schedules,
  onSwitchSchedule,
  canSave,
  saving,
  dirty,
  saved,
  onSave,
  onDelete,
  onImport,
  onGenerate,
  canGenerate,
}: {
  name: string;
  onNameChange: (name: string) => void;
  termId: string;
  onTermChange: (termId: string) => void;
  terms: { id: string; name: string }[];
  scheduleId: string | null;
  /** Existing share token for this schedule, or null when it isn't shared. */
  shareToken?: string | null;
  schedules: ScheduleOption[];
  onSwitchSchedule: (scheduleId: string) => void;
  canSave: boolean;
  saving: boolean;
  dirty: boolean;
  /** A save landed this session and nothing has changed since. */
  saved: boolean;
  onSave: () => void;
  onDelete: () => void;
  onImport: () => void;
  onGenerate: () => void;
  /** False until there are courses to build from and a term to build in. */
  canGenerate: boolean;
}) {
  const activeTerm = terms.find((t) => t.id === termId);

  return (
    // Two tight rows rather than a tall block with a stacked column of buttons
    // on the right: this strip sits above the calendar now, and every pixel it
    // takes is one the week loses.
    <div className="border-b border-border px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            required
            maxLength={80}
            placeholder="Schedule name"
            aria-label="Schedule name"
            className="w-56 rounded-input border border-border bg-surface px-3 py-1.5 text-base font-semibold text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
          />
          <ScheduleSwitcher
            schedules={schedules}
            currentId={scheduleId}
            onSelect={onSwitchSchedule}
          />
          <button
            type="button"
            onClick={onImport}
            className="shrink-0 rounded-pill border border-border px-4 py-1.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
          >
            Import from Workday
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            title={canGenerate ? undefined : 'Add courses first, then let Flow Builder arrange them'}
            className="shrink-0 rounded-pill border border-border px-4 py-1.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            Flow Builder
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            The counterpart to "Unsaved changes". Saving used to succeed in
            total silence — the button simply went disabled — so the only
            signal that it worked was the absence of an error, which is not a
            signal. No timer clears it: it is true whenever a save has landed
            and nothing has changed since, so editing anything removes it on
            its own and it can never claim more than it knows.
          */}
          {dirty ? (
            <span className="text-xs text-text-tertiary">Unsaved changes</span>
          ) : (
            saved && (
              <span role="status" className="text-xs font-medium text-info">
                Saved
              </span>
            )
          )}

          {/* Nothing changed means nothing to save — a live button there just
              fires a no-op round trip and makes "Unsaved changes" ambiguous. */}
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || !dirty || saving}
            title={
              saving || (canSave && dirty)
                ? undefined
                : !canSave
                  ? 'Name the schedule and add a section before saving'
                  : 'No changes to save'
            }
            // border-transparent matches the bordered pills beside it, so the
            // three read as one set at exactly the same height.
            className="rounded-pill border border-transparent bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          {/* Delete needs a persisted schedule — hidden, not disabled, in draft. */}
          {scheduleId && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-pill border border-border px-4 py-1.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:border-danger-border hover:bg-danger-surface hover:text-danger active:scale-100"
            >
              Delete Schedule
            </button>
          )}

          {/* Sharing before subscribing: "send this to someone" is the more
              common intent, and the two are different enough to sit apart. */}
          {scheduleId && (
            <ShareLinkMenu
              initialToken={shareToken}
              pathFor={(t) => `/shared/${t}`}
              enable={() => enableScheduleSharing(scheduleId)}
              disable={() => disableScheduleSharing(scheduleId)}
              description="Creates a link that shows this schedule to anyone who opens it, without signing in. It doesn't show your name or email."
            />
          )}

          {scheduleId && (
            <CalendarSubscribeMenu
              getUrl={async () => {
                const result = await getSubscribeUrl(scheduleId);
                return result.ok ? `${window.location.origin}/api/calendar/${result.token}` : null;
              }}
            />
          )}
        </div>
      </div>

      {/* On phones a saved schedule hides this whole row: the term is fixed,
          already visible in the schedule name area, and the label + disabled
          select + caption cost a full row of header the calendar needs. */}
      <div
        className={`mt-1.5 flex flex-wrap items-center gap-2 ${
          scheduleId !== null ? 'max-sm:hidden' : ''
        }`}
      >
        <label htmlFor="builderTerm" className="text-xs text-text-tertiary">
          Academic Period
        </label>
        <select
          id="builderTerm"
          value={termId}
          onChange={(e) => onTermChange(e.target.value)}
          disabled={scheduleId !== null}
          title={scheduleId !== null ? 'Term is fixed for a saved schedule' : undefined}
          className="rounded-input border border-border bg-background px-2 py-0.5 text-xs text-foreground focus:border-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {scheduleId !== null && (
          <span className="text-xs text-text-tertiary">Term is fixed for a saved schedule</span>
        )}
        {scheduleId === null && activeTerm === undefined && (
          <span className="text-xs text-text-tertiary">Select a term</span>
        )}
      </div>
    </div>
  );
}
