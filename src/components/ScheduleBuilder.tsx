'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ScheduleHeader from '@/components/schedule/ScheduleHeader';
import SchedulePanelTabs from '@/components/schedule/SchedulePanelTabs';
import ScheduleCalendar, { type CalendarEntry } from '@/components/schedule/ScheduleCalendar';
import CourseInfoOverlay from '@/components/schedule/CourseInfoOverlay';
import CourseInfoPanel from '@/components/schedule/course-info/CourseInfoPanel';
import SwapOverlay from '@/components/schedule/SwapOverlay';
import WorkdayImportOverlay from '@/components/schedule/WorkdayImportOverlay';
import UnsavedWorkDialog from '@/components/schedule/UnsavedWorkDialog';
import ConflictSaveDialog from '@/components/schedule/ConflictSaveDialog';
import type { ScheduleOption } from '@/components/schedule/ScheduleSwitcher';
import { findConflicts, conflictKey } from '@/schedule/conflicts';
import { diffSections, swapSection } from '@/schedule/buffer';
import {
  saveGuestSchedule,
  replaceScheduleSections,
  deleteSchedule,
} from '@/app/actions/schedule';
import type { SectionHit } from '@/lib/search';
import type { ImportedTerm } from '@/upload/match-schedule';
import { useAuthOverlay } from '@/components/AuthOverlayContext';
import { useUnsavedChanges } from '@/components/UnsavedChangesContext';
import { getCurrentAndNextTerm } from '@/schedule/terms';
import { readPendingTerms, writePendingTerms } from '@/schedule/pending-import';

export type BuilderMode = { kind: 'draft' } | { kind: 'saved'; scheduleId: string };

/**
 * The single schedule builder, behind both /schedule/new (draft) and
 * /schedule/[id] (saved).
 *
 * Both modes hold the working section set in client state and commit only on
 * Save (spec §3.1): it matches Workday's own Save/Cancel model, it gives one
 * rendering path for both modes, and it stops a bulk Workday import from
 * firing a burst of writes for edits the student hasn't agreed to yet.
 */
export default function ScheduleBuilder({
  mode,
  initialName,
  initialTermId,
  initialSections,
  terms,
  schedules = [],
  openImport = false,
  loadPendingImport = false,
}: {
  mode: BuilderMode;
  initialName: string;
  initialTermId: string;
  initialSections: SectionHit[];
  terms: { id: string; name: string; year: number; session: string; termNumber: number | null }[];
  /** The student's other saved schedules, for the switcher beside the name. */
  schedules?: ScheduleOption[];
  openImport?: boolean;
  /** Set by /schedule/new?fromImport=1 — consume the next term parked by a
   *  multi-term Workday import and open it as a fresh draft. */
  loadPendingImport?: boolean;
}) {
  const [name, setName] = useState(initialName);
  // On /schedule/new with no termId query param, initialTermId is '' — falling
  // back to terms[0] must feed BOTH the initial state and the dirty
  // comparison, or a pristine page reports dirty against '' the instant terms
  // load and arms the beforeunload guard before the student has done anything.
  const effectiveInitialTermId = initialTermId || (terms[0]?.id ?? '');
  const [termId, setTermId] = useState(effectiveInitialTermId);
  const [chosen, setChosen] = useState<SectionHit[]>(initialSections);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoCourseId, setInfoCourseId] = useState<string | null>(null);
  const [infoDocked, setInfoDocked] = useState(false);
  const [swapping, setSwapping] = useState<SectionHit | null>(null);
  const [dismissedConflicts, setDismissedConflicts] = useState<string | null>(null);
  // Non-null while the conflict gate is open, holding the options `trySave`
  // was originally called with — replayed verbatim (plus conflictsConfirmed)
  // when the student picks "Save anyway", so a gated save-and-switch still
  // switches instead of silently reverting to defaults.
  const [pendingSave, setPendingSave] = useState<{ redirectAfterCreate: boolean } | null>(null);
  const [importOpen, setImportOpen] = useState(openImport);
  // A successful save moves the baseline immediately. router.refresh() is not
  // awaited, so the refreshed initialSections prop lands later — without this,
  // a quick second Save would send a stale baseline and be refused as stale.
  const [savedBaseline, setSavedBaseline] = useState<{ ids: string[]; name: string } | null>(null);
  // Terms from a multi-term Workday export that this schedule isn't holding.
  // Parked in sessionStorage rather than state because the offer to build them
  // has to survive the navigation a save performs.
  const [pendingTerms, setPendingTerms] = useState<ImportedTerm[]>([]);
  const [offeredTerm, setOfferedTerm] = useState<ImportedTerm | null>(null);
  // A navigation held back until the student decides what to do with unsaved
  // work. Wrapped in an object because useState would otherwise call a bare
  // function argument as an updater.
  const [pendingNav, setPendingNav] = useState<{ go: () => void } | null>(null);
  const router = useRouter();
  const { open } = useAuthOverlay();
  const { setDirty } = useUnsavedChanges();

  const scheduleId = mode.kind === 'saved' ? mode.scheduleId : null;

  // On /schedule/new?fromImport=1, adopt the next parked term as this draft.
  // Anywhere else, a parked term becomes an offer rather than hijacking the
  // page the student actually asked for.
  useEffect(() => {
    const parked = readPendingTerms();
    if (parked.length === 0) return;

    if (loadPendingImport && mode.kind === 'draft') {
      const [next, ...rest] = parked;
      writePendingTerms(rest);
      setPendingTerms(rest);
      setName(next.termName);
      setTermId(next.termId);
      setChosen(next.matched);
      return;
    }
    setPendingTerms(parked);
    setOfferedTerm(parked[0]);
    // Reading it is enough — the offer now lives in component state, and
    // leaving it parked would re-offer it on every unrelated page load.
    writePendingTerms([]);
  }, [loadPendingImport, mode.kind]);
  const initialIds = useMemo(
    () => initialSections.map((s) => s.sectionId),
    [initialSections],
  );
  const baselineIds = savedBaseline?.ids ?? initialIds;
  const baselineName = savedBaseline?.name ?? initialName;

  // Clear the local override once the real props catch up, so a genuine
  // external change is still authoritative on the next load.
  useEffect(() => {
    setSavedBaseline(null);
  }, [initialIds, initialName]);

  const dirty = useMemo(() => {
    const { added, removed } = diffSections(
      baselineIds,
      chosen.map((c) => c.sectionId),
    );
    // Term is read-only for a saved schedule (its sections are term-scoped,
    // so re-pointing termId would orphan them — Save never persists it), so
    // a term change there must never be reported as dirty. In draft mode
    // nothing is persisted yet, so termId still counts.
    return (
      added.length > 0 ||
      removed.length > 0 ||
      name.trim() !== baselineName.trim() ||
      (scheduleId === null && termId !== effectiveInitialTermId)
    );
  }, [baselineIds, chosen, name, baselineName, scheduleId, termId, effectiveInitialTermId]);

  // Whether the schedule is well-formed enough to persist. Kept separate from
  // `dirty`: the Save button needs both, but the unsaved-work prompt has to
  // distinguish "nothing to save" from "cannot be saved yet".
  //
  // A section is required only to CREATE a schedule. Demanding one to update an
  // existing schedule would strand two legitimate edits: renaming a schedule
  // that has none, and removing the last section from one that does.
  const contentSaveable =
    name.trim().length > 0 && termId !== '' && (scheduleId !== null || chosen.length > 0);

  // Buffered edits live only in memory, so leaving the page drops them. Without
  // this guard an imported schedule can vanish on a stray back-navigation.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  /**
   * The single door out of the builder. router.push is a client-side
   * navigation, which neither `beforeunload` nor the nav-link guard can see —
   * routing every in-builder jump through here is what stops an unsaved
   * import from vanishing.
   */
  function requestNav(go: () => void) {
    if (!dirty) {
      go();
      return;
    }
    setPendingNav({ go });
  }

  function addSection(hit: SectionHit) {
    setChosen((prev) =>
      prev.some((s) => s.sectionId === hit.sectionId) ? prev : [...prev, hit],
    );
  }

  function removeSection(sectionId: string) {
    setChosen((prev) => prev.filter((s) => s.sectionId !== sectionId));
  }

  function applySwap(next: SectionHit) {
    if (!swapping) return;
    setChosen((prev) => swapSection(prev, swapping.sectionId, next));
    setSwapping(null);
  }

  /** The calendar knows a sectionId; the overlay needs the whole hit. */
  function startSwapById(sectionId: string) {
    setSwapping(chosen.find((s) => s.sectionId === sectionId) ?? null);
  }

  function applyImport(term: ImportedTerm, otherTerms: ImportedTerm[] = []) {
    const importedTermId = term.termId;
    const sections = term.matched;
    // Only terms the student can actually plan; a past term can't be built.
    setPendingTerms(otherTerms.filter((t) => terms.some((x) => x.id === t.termId)));
    if (!terms.some((t) => t.id === importedTermId)) {
      setError(
        "That export is for a term you can't plan yet, so nothing was imported.",
      );
      return;
    }
    setError(null);
    setTermId(importedTermId);
    // Merge rather than replace: a student may have added sections before
    // importing. addSection's dedupe rule is applied here too.
    setChosen((prev) => {
      const have = new Set(prev.map((s) => s.sectionId));
      return [...prev, ...sections.filter((s) => !have.has(s.sectionId))];
    });
  }

  /** Resolves true only when the schedule is persisted. `redirectAfterCreate`
   *  is false when a pending navigation supersedes the jump to the new
   *  schedule — two router.push calls would otherwise race. */
  async function trySave({
    redirectAfterCreate = true,
    conflictsConfirmed = false,
  } = {}): Promise<boolean> {
    // Save is where an overlap stops being a sketch, so it is the one place we
    // ask. Planning stays silent on purpose.
    if (!conflictsConfirmed && conflicts.length > 0) {
      setPendingSave({ redirectAfterCreate });
      return false;
    }

    setSaving(true);
    setError(null);
    const sectionIds = chosen.map((c) => c.sectionId);
    // Park before saving: the guest path navigates away on success, and the
    // offer has to outlive that.
    writePendingTerms(pendingTerms);

    try {
      if (scheduleId) {
        const result = await replaceScheduleSections(scheduleId, name, sectionIds, baselineIds);
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        setSavedBaseline({ ids: sectionIds, name: name.trim() });
        router.refresh();
        return true;
      }

      const result = await saveGuestSchedule(termId, name, sectionIds);
      if (result.ok) {
        if (redirectAfterCreate) router.push(`/schedule/${result.scheduleId}`);
        // Clears `dirty` so the guard doesn't fire again on the way out.
        else setSavedBaseline({ ids: sectionIds, name: name.trim() });
        return true;
      }
      if (result.needsAuth) {
        // Carry the original call's options through login — otherwise
        // conflictsConfirmed reverts to false and a guest who already
        // confirmed an overlap gets asked about the same overlap again
        // after signing in, and redirectAfterCreate is lost the same way.
        open('login', () => {
          void trySave({ redirectAfterCreate, conflictsConfirmed });
        });
        return false;
      }
      setError(result.error);
      return false;
    } catch {
      setError('Could not save your schedule. Your changes are still here, so try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!scheduleId) return;
    const confirmed = window.confirm(
      `Delete "${name}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    const result = await deleteSchedule(scheduleId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push('/schedule');
  }

  const entries: CalendarEntry[] = chosen.flatMap((s) =>
    s.meetingTimes.map((m, i) => ({
      id: `${s.sectionId}-${i}`,
      sectionId: s.sectionId,
      label: `${s.code} ${s.sectionCode}`,
      courseCode: s.code,
      courseId: s.courseId,
      day: m.day,
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.building ? `${m.building}${m.room ? ` ${m.room}` : ''}` : null,
      instructor: s.instructors[0] ?? null,
    })),
  );
  const conflicts = findConflicts(entries);
  // Derived, not an effect: this file is already subject to the
  // set-state-in-effect rule, and resetting on change needs no effect at all.
  // A new or different overlap produces a new key, so the banner returns.
  const currentConflictKey = conflictKey(conflicts);
  // A dismissal must not outlive the overlaps it was for: once the set is
  // empty, forget it — otherwise removing and re-adding the same pair would
  // recompute the identical key and the banner would stay silently
  // suppressed. Render-time state update (not an effect): React re-renders
  // immediately without committing the stale intermediate frame, and this
  // self-stabilises after one pass since it no longer fires once null.
  if (conflicts.length === 0 && dismissedConflicts !== null) {
    setDismissedConflicts(null);
  }
  const showConflictBanner =
    conflicts.length > 0 && dismissedConflicts !== currentConflictKey;
  const showNowIndicator = getCurrentAndNextTerm(terms).current?.id === termId;
  const addedSectionIds = new Set(chosen.map((c) => c.sectionId));

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col">
      {error && (
        <p role="alert" className="border-b border-border px-6 py-2 text-sm text-danger">{error}</p>
      )}

      {offeredTerm && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-muted px-6 py-3">
          <p className="text-sm text-foreground">
            Your import also covered{' '}
            <span className="font-medium">{offeredTerm.termName}</span> (
            {offeredTerm.matched.length} section
            {offeredTerm.matched.length === 1 ? '' : 's'}). Build a schedule for it?
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOfferedTerm(null);
                setPendingTerms([]);
                writePendingTerms([]);
              }}
              className="rounded-pill px-3 py-1 text-xs text-text-secondary transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface active:scale-100"
            >
              No thanks
            </button>
            <button
              type="button"
              onClick={() =>
                // Everything happens inside the callback so that cancelling at
                // the unsaved-work prompt leaves this offer exactly as it was.
                requestNav(() => {
                  // Hand the parked terms back to sessionStorage and let
                  // /schedule/new adopt the next one as a fresh draft.
                  writePendingTerms(pendingTerms);
                  setOfferedTerm(null);
                  router.push('/schedule/new?fromImport=1');
                })
              }
              className="rounded-pill bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100"
            >
              Build {offeredTerm.termName}
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-2 w-full shrink-0 overflow-y-auto border-b border-border lg:order-1 lg:w-[340px] lg:border-b-0 lg:border-r">
          <SchedulePanelTabs
            termId={termId}
            chosen={chosen}
            onAdd={addSection}
            onRemove={removeSection}
            // `i` always opens the overlay and the dock button always opens
            // the side panel, rather than either inheriting whichever mode
            // was last used.
            onInfo={(courseId) => {
              setInfoDocked(false);
              setInfoCourseId(courseId);
            }}
            onDock={(courseId) => {
              setInfoDocked(true);
              setInfoCourseId(courseId);
            }}
            onSwap={(section) => setSwapping(section)}
          />
        </aside>

        <div className="order-1 flex min-w-0 flex-1 flex-col lg:order-2">
          <ScheduleHeader
            name={name}
            onNameChange={setName}
            termId={termId}
            onTermChange={setTermId}
            terms={terms}
            scheduleId={scheduleId}
            schedules={schedules}
            onSwitchSchedule={(id) => requestNav(() => router.push(`/schedule/${id}`))}
            canSave={contentSaveable}
            saving={saving}
            dirty={dirty}
            onSave={() => void trySave()}
            onDelete={onDelete}
            onImport={() => setImportOpen(true)}
          />

          {/* The banner floats over the calendar rather than sitting above it
              in flow: as a block it pushed the whole grid down the moment a
              conflict appeared and let it spring back on dismissal, so the
              times you were trying to read moved under you exactly when you
              looked at them. The scroll container is a child of this wrapper,
              not the wrapper itself, so the banner stays pinned instead of
              scrolling away from the conflict it describes. */}
          <div className="relative min-h-0 flex-1">
            {/* z-30 clears the calendar's sticky day-header row, which is z-20
                and comes later in the DOM — at equal z the header won and
                covered the banner's heading and dismiss button. */}
            {showConflictBanner && (
              <div className="pointer-events-none absolute inset-x-4 top-3 z-30">
                <div className="pointer-events-auto relative rounded-card border border-danger-border bg-danger-surface p-3 pr-9 text-sm text-danger shadow-lg">
                  <button
                    type="button"
                    onClick={() => setDismissedConflicts(currentConflictKey)}
                    aria-label="Dismiss conflict warning"
                    className="absolute right-2 top-2 rounded px-1 text-danger transition-opacity hover:opacity-70"
                  >
                    ×
                  </button>
                  <p className="font-medium">
                    {conflicts.length} scheduling conflict
                    {conflicts.length === 1 ? '' : 's'} detected
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {conflicts.map((c, i) => (
                      <li key={i}>
                        {c.a.label} overlaps {c.b.label} on {c.a.day}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="h-full overflow-auto px-4 pb-4 pt-3">
              <ScheduleCalendar
                entries={entries}
                onRemove={removeSection}
                showNowIndicator={showNowIndicator}
                onSelectCourse={setInfoCourseId}
                onSwap={startSwapById}
              />
            </div>
          </div>
        </div>

        {infoDocked && infoCourseId && (
          <CourseInfoPanel
            courseId={infoCourseId}
            termId={termId}
            addedSectionIds={addedSectionIds}
            onAddSection={addSection}
            onRemoveSection={removeSection}
            onExpand={() => setInfoDocked(false)}
            onClose={() => {
              setInfoDocked(false);
              setInfoCourseId(null);
            }}
          />
        )}
      </div>

      <CourseInfoOverlay
        courseId={infoDocked ? null : infoCourseId}
        termId={termId}
        addedSectionIds={addedSectionIds}
        onAddSection={addSection}
        onRemoveSection={removeSection}
        onDock={() => setInfoDocked(true)}
        onClose={() => setInfoCourseId(null)}
      />

      <SwapOverlay
        section={swapping}
        termId={termId}
        addedIds={addedSectionIds}
        onSwap={applySwap}
        onClose={() => setSwapping(null)}
      />

      <ConflictSaveDialog
        conflicts={pendingSave ? conflicts : []}
        onCancel={() => setPendingSave(null)}
        onConfirm={async () => {
          // Replay the save with the SAME options the gate captured — not
          // trySave's defaults — so a gated "save and switch" still switches.
          const redirectAfterCreate = pendingSave?.redirectAfterCreate ?? true;
          setPendingSave(null);
          const saved = await trySave({ redirectAfterCreate, conflictsConfirmed: true });
          if (!saved) return;
          // Mirrors UnsavedWorkDialog's own onSave: complete the navigation
          // that was parked behind it, now that the save actually went through.
          if (pendingNav) {
            const { go } = pendingNav;
            setPendingNav(null);
            go();
          }
        }}
      />

      <WorkdayImportOverlay
        open={importOpen}
        onClose={() => setImportOpen(false)}
        plannableTermIds={terms.map((t) => t.id)}
        onImport={applyImport}
      />

      {pendingNav && (
        <UnsavedWorkDialog
          name={name}
          saving={saving}
          canSave={contentSaveable}
          onSave={async () => {
            const saved = await trySave({ redirectAfterCreate: false });
            // `false` here means either a real failure (error banner is up)
            // or the conflict gate just opened ConflictSaveDialog on top of
            // this one — either way, stay put rather than navigating away
            // from work that did not persist.
            if (!saved) return;
            const { go } = pendingNav;
            setPendingNav(null);
            go();
          }}
          onDiscard={() => {
            const { go } = pendingNav;
            setPendingNav(null);
            go();
          }}
          onCancel={() => setPendingNav(null)}
        />
      )}
    </main>
  );
}
