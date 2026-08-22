'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import WeekGrid, { type WeekGridEntry } from '@/components/WeekGrid';
import { findConflicts } from '@/schedule/conflicts';
import { searchSections, saveGuestSchedule } from '@/app/actions/schedule';
import type { SectionHit } from '@/lib/search';
import { useAuthOverlay } from '@/components/AuthOverlayContext';

type Term = { id: string; name: string };

export default function ScheduleBuilder({
  initialName,
  initialTermId,
  terms,
}: {
  initialName: string;
  initialTermId: string;
  terms: Term[];
}) {
  const [name, setName] = useState(initialName);
  const [termId, setTermId] = useState(initialTermId || (terms[0]?.id ?? ''));
  const [chosen, setChosen] = useState<SectionHit[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SectionHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { open } = useAuthOverlay();

  const chosenIds = new Set(chosen.map((c) => c.sectionId));

  async function onSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSearching(true);
    setResults(await searchSections(query, termId));
    setSearching(false);
  }

  function addSection(hit: SectionHit) {
    if (chosenIds.has(hit.sectionId)) return;
    setChosen((prev) => [...prev, hit]);
  }

  function removeSection(sectionId: string) {
    setChosen((prev) => prev.filter((s) => s.sectionId !== sectionId));
  }

  async function trySave() {
    setSaving(true);
    setError(null);
    const result = await saveGuestSchedule(
      termId,
      name,
      chosen.map((c) => c.sectionId),
    );
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
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-sm flex-1 flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Schedule name"
            required
            maxLength={80}
            className="flex-1 rounded-lg border px-3 py-2 text-lg font-semibold"
          />
          <select
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" onClick={trySave} disabled={saving || !name.trim() || !termId}>
          {saving ? 'Saving…' : 'Save schedule'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <p className="mt-2 text-xs text-slate-500">
        Build your schedule freely — you&apos;ll only be asked to sign in when you save it.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[320px_1fr]">
        <aside>
          <h2 className="text-lg font-semibold">Add sections</h2>
          <form onSubmit={onSearch} className="mt-3 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. CPSC 221"
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
            />
            <Button type="submit" variant="secondary" disabled={searching || !termId}>
              Search
            </Button>
          </form>

          <ul className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {results.map((r) => {
              const added = chosenIds.has(r.sectionId);
              return (
                <li key={r.sectionId} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    {r.code} {r.sectionCode}
                  </p>
                  <p className="truncate text-xs text-slate-600">{r.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {r.activity ?? '—'} · {r.meetings}
                  </p>
                  {added ? (
                    <p className="mt-2 text-xs font-medium text-slate-400">Already added</p>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => addSection(r)}
                    >
                      Add
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        <div>
          {conflicts.length > 0 && (
            <div className="rounded-lg border border-red-600 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-medium">
                {conflicts.length} scheduling conflict{conflicts.length === 1 ? '' : 's'} detected
              </p>
              <ul className="mt-2 space-y-1">
                {conflicts.map((c, i) => (
                  <li key={i}>
                    {c.a.label} overlaps {c.b.label} on {c.a.day}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h2 className={`text-xl font-semibold ${conflicts.length > 0 ? 'mt-8' : ''}`}>
            Weekly view
          </h2>
          <div className="mt-4">
            <WeekGrid entries={entries} />
          </div>

          <h2 className="mt-8 text-xl font-semibold">Sections</h2>
          {chosen.length === 0 ? (
            <p className="mt-2 text-slate-500">No sections added yet. Search on the left.</p>
          ) : (
            <ul className="mt-4 divide-y">
              {chosen.map((s) => (
                <li key={s.sectionId} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">
                      {s.code} {s.sectionCode}
                    </p>
                    <p className="text-sm text-slate-500">{s.activity ?? '—'}</p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => removeSection(s.sectionId)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
