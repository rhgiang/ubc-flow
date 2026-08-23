'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ScheduleHeader from '@/components/schedule/ScheduleHeader';
import SchedulePanelTabs from '@/components/schedule/SchedulePanelTabs';
import ScheduleCalendar, { type CalendarEntry } from '@/components/schedule/ScheduleCalendar';
import CourseInfoOverlay from '@/components/schedule/CourseInfoOverlay';
import CourseInfoPanel from '@/components/schedule/course-info/CourseInfoPanel';
import WorkdayImportOverlay from '@/components/schedule/WorkdayImportOverlay';
import { findConflicts } from '@/schedule/conflicts';
import { diffSections } from '@/schedule/buffer';
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

export type BuilderMode = { kind: 'draft' } | { kind: 'saved'; scheduleId: string };

/** Terms from a multi-term Workday import that no schedule holds yet. */
const PENDING_TERMS_KEY = 'ubcflow:workday-pending-terms';

function readPendingTerms(): ImportedTerm[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(PENDING_TERMS_KEY);
    return raw ? (JSON.parse(raw) as ImportedTerm[]) : [];
  } catch {
    return [];
  }
}

function writePendingTerms(terms: ImportedTerm[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (terms.length === 0) window.sessionStorage.removeItem(PENDING_TERMS_KEY);
    else window.sessionStorage.setItem(PENDING_TERMS_KEY, JSON.stringify(terms));
  } catch {
    // A blocked sessionStorage only costs the follow-up offer, not the import.
  }
}

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
  openImport = false,
  loadPendingImport = false,
}: {
  mode: BuilderMode;
  initialName: string;
  initialTermId: string;
  initialSections: SectionHit[];
  terms: { id: string; name: string; year: number; session: string; termNumber: number | null }[];
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

  function addSection(hit: SectionHit) {
    setChosen((prev) =>
      prev.some((s) => s.sectionId === hit.sectionId) ? prev : [...prev, hit],
    );
  }

  function removeSection(sectionId: string) {
    setChosen((prev) => prev.filter((s) => s.sectionId !== sectionId));
  }

  function applyImport(
    importedTermId: string,
    sections: SectionHit[],
    otherTerms: ImportedTerm[] = [],
  ) {
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

  async function trySave() {
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
          return;
        }
        setSavedBaseline({ ids: sectionIds, name: name.trim() });
        router.refresh();
        return;
      }

      const result = await saveGuestSchedule(termId, name, sectionIds);
      if (result.ok) {
        router.push(`/schedule/${result.scheduleId}`);
        return;
      }
      if (result.needsAuth) {
        open('login', trySave);
        return;
      }
      setError(result.error);
    } catch {
      setError('Could not save your schedule. Your changes are still here — try again.');
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
    })),
  );
  const conflicts = findConflicts(entries);
  const showNowIndicator = getCurrentAndNextTerm(terms).current?.id === termId;
  const addedSectionIds = new Set(chosen.map((c) => c.sectionId));

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col">
      <ScheduleHeader
        name={name}
        onNameChange={setName}
        termId={termId}
        onTermChange={setTermId}
        terms={terms}
        scheduleId={scheduleId}
        canSave={chosen.length > 0 && name.trim().length > 0 && termId !== ''}
        saving={saving}
        dirty={dirty}
        onSave={trySave}
        onDelete={onDelete}
        onImport={() => setImportOpen(true)}
      />

      {error && (
        <p className="border-b border-border px-6 py-2 text-sm text-danger">{error}</p>
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
              onClick={() => {
                // Hand the parked terms back to sessionStorage and let
                // /schedule/new adopt the next one as a fresh draft.
                writePendingTerms(pendingTerms);
                setOfferedTerm(null);
                router.push('/schedule/new?fromImport=1');
              }}
              className="rounded-pill bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100"
            >
              Build {offeredTerm.termName}
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-border lg:w-[340px] lg:border-b-0 lg:border-r">
          <SchedulePanelTabs
            termId={termId}
            chosen={chosen}
            onAdd={addSection}
            onRemove={removeSection}
            onInfo={setInfoCourseId}
          />
        </aside>

        <div className="min-w-0 flex-1 overflow-auto p-4">
          {conflicts.length > 0 && (
            <div className="mb-4 rounded-card border border-danger-border bg-danger-surface p-3 text-sm text-danger">
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
          )}

          <ScheduleCalendar
            entries={entries}
            onRemove={removeSection}
            showNowIndicator={showNowIndicator}
            onSelectCourse={setInfoCourseId}
          />
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

      <WorkdayImportOverlay
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={applyImport}
      />
    </main>
  );
}
