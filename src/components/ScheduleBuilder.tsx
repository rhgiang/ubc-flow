'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ScheduleHeader from '@/components/schedule/ScheduleHeader';
import SchedulePanelTabs from '@/components/schedule/SchedulePanelTabs';
import WeekGrid, { type WeekGridEntry } from '@/components/WeekGrid';
import { findConflicts } from '@/schedule/conflicts';
import { diffSections } from '@/schedule/buffer';
import {
  saveGuestSchedule,
  replaceScheduleSections,
  deleteSchedule,
} from '@/app/actions/schedule';
import type { SectionHit } from '@/lib/search';
import { useAuthOverlay } from '@/components/AuthOverlayContext';

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
}: {
  mode: BuilderMode;
  initialName: string;
  initialTermId: string;
  initialSections: SectionHit[];
  terms: { id: string; name: string }[];
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
  const router = useRouter();
  const { open } = useAuthOverlay();

  const scheduleId = mode.kind === 'saved' ? mode.scheduleId : null;
  const initialIds = useMemo(
    () => initialSections.map((s) => s.sectionId),
    [initialSections],
  );

  const dirty = useMemo(() => {
    const { added, removed } = diffSections(
      initialIds,
      chosen.map((c) => c.sectionId),
    );
    // Term is read-only for a saved schedule (its sections are term-scoped,
    // so re-pointing termId would orphan them — Save never persists it), so
    // a term change there must never be reported as dirty. In draft mode
    // nothing is persisted yet, so termId still counts.
    return (
      added.length > 0 ||
      removed.length > 0 ||
      name.trim() !== initialName.trim() ||
      (scheduleId === null && termId !== effectiveInitialTermId)
    );
  }, [initialIds, chosen, name, initialName, scheduleId, termId, effectiveInitialTermId]);

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

  function addSection(hit: SectionHit) {
    setChosen((prev) =>
      prev.some((s) => s.sectionId === hit.sectionId) ? prev : [...prev, hit],
    );
  }

  function removeSection(sectionId: string) {
    setChosen((prev) => prev.filter((s) => s.sectionId !== sectionId));
  }

  async function trySave() {
    setSaving(true);
    setError(null);
    const sectionIds = chosen.map((c) => c.sectionId);

    if (scheduleId) {
      const result = await replaceScheduleSections(scheduleId, name, sectionIds);
      setSaving(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      return;
    }

    const result = await saveGuestSchedule(termId, name, sectionIds);
    if (result.ok) {
      router.push(`/schedule/${result.scheduleId}`);
      return;
    }
    setSaving(false);
    if (result.needsAuth) {
      open('login', trySave);
      return;
    }
    setError(result.error);
  }

  async function onDelete() {
    if (!scheduleId) return;
    const result = await deleteSchedule(scheduleId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push('/schedule');
  }

  const entries: WeekGridEntry[] = chosen.flatMap((s) =>
    s.meetingTimes.map((m, i) => ({
      id: `${s.sectionId}-${i}`,
      sectionId: s.sectionId,
      label: `${s.code} ${s.sectionCode}`,
      day: m.day,
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.building ? `${m.building}${m.room ? ` ${m.room}` : ''}` : null,
    })),
  );
  const conflicts = findConflicts(entries);

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
      />

      {error && (
        <p className="border-b border-border px-6 py-2 text-sm text-red-600">{error}</p>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-border lg:w-[340px] lg:border-b-0 lg:border-r">
          <SchedulePanelTabs
            termId={termId}
            chosen={chosen}
            onAdd={addSection}
            onRemove={removeSection}
          />
        </aside>

        <div className="min-w-0 flex-1 overflow-auto p-4">
          {conflicts.length > 0 && (
            <div className="mb-4 rounded-card border border-red-600 bg-red-50 p-3 text-sm text-red-800">
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

          <WeekGrid entries={entries} />
        </div>
      </div>
    </main>
  );
}
