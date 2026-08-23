'use client';

import CalendarSubscribeMenu from '@/components/schedule/CalendarSubscribeMenu';

export default function ScheduleHeader({
  name,
  onNameChange,
  termId,
  onTermChange,
  terms,
  scheduleId,
  canSave,
  saving,
  dirty,
  onSave,
  onDelete,
  onImport,
}: {
  name: string;
  onNameChange: (name: string) => void;
  termId: string;
  onTermChange: (termId: string) => void;
  terms: { id: string; name: string }[];
  scheduleId: string | null;
  canSave: boolean;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onDelete: () => void;
  onImport: () => void;
}) {
  const activeTerm = terms.find((t) => t.id === termId);

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            required
            maxLength={80}
            placeholder="Schedule name"
            aria-label="Schedule name"
            className="w-full max-w-sm rounded-input border border-border bg-background px-3 py-2 text-lg font-semibold text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={onImport}
            className="shrink-0 rounded-pill border border-border px-4 py-2 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
          >
            Import from Workday
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="builderTerm" className="text-xs text-text-tertiary">
            Academic Period
          </label>
          <select
            id="builderTerm"
            value={termId}
            onChange={(e) => onTermChange(e.target.value)}
            disabled={scheduleId !== null}
            title={
              scheduleId !== null ? 'Term is fixed for a saved schedule' : undefined
            }
            className="rounded-input border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
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

      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          {/* Delete needs a persisted schedule — hidden, not disabled, in draft. */}
          {scheduleId && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-pill border border-border px-5 py-2 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:border-danger-border hover:bg-danger-surface hover:text-danger active:scale-100"
            >
              Delete Schedule
            </button>
          )}
        </div>

        {scheduleId && <CalendarSubscribeMenu scheduleId={scheduleId} />}

        {dirty && <p className="text-xs text-text-tertiary">Unsaved changes</p>}
      </div>
    </div>
  );
}
