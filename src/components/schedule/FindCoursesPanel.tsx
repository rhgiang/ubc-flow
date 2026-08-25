'use client';

import { useEffect, useState } from 'react';
import { searchSections } from '@/app/actions/schedule';
import { groupSectionsByCourse } from '@/schedule/group';
import { courseColorIndex } from '@/schedule/colors';
import CourseHeaderActions from '@/components/schedule/CourseHeaderActions';
import type { SectionHit } from '@/lib/search';

// Matches SearchBar's debounce so the whole app feels consistent while typing.
const DEBOUNCE_MS = 200;

export default function FindCoursesPanel({
  termId,
  addedIds,
  onAdd,
  onInfo,
  onDock,
  initialQuery = '',
  actionLabel = 'Add',
  currentSectionId,
}: {
  termId: string;
  addedIds: Set<string>;
  onAdd: (hit: SectionHit) => void;
  onInfo?: (courseId: string) => void;
  onDock?: (courseId: string) => void;
  /** Seeds the search box. The panel already searches by code or title, so
   *  passing a course code lists that course's sections with no extra fetch. */
  initialQuery?: string;
  actionLabel?: string;
  /** The section being replaced, when the panel is used to swap. Rendered as
   *  "Current" rather than "Added", which is true but useless in that context. */
  currentSectionId?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SectionHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Stale sections from a previous term must never stay clickable while the
  // new term's results are still in flight.
  useEffect(() => {
    setResults([]);
  }, [termId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !termId) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const hits = await searchSections(trimmed, termId);
      // A slower earlier request must never overwrite a newer one's results.
      if (cancelled) return;
      setResults(hits);
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, termId]);

  const groups = groupSectionsByCourse(results);

  return (
    <div className="p-4">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by code or title — ex: CPSC 110"
        aria-label="Search courses"
        className="w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
      />

      {searching && <p className="mt-3 text-xs text-text-tertiary">Searching…</p>}

      {!searching && query.trim() && groups.length === 0 && (
        <p className="mt-3 text-sm text-text-secondary">No courses match that search.</p>
      )}

      <div className="mt-3 space-y-2">
        {groups.map((group) => {
          const slot = courseColorIndex(group.code);
          return (
          <details key={group.code} className="overflow-hidden rounded-card border border-border">
            {/* Same pastel + accent-bar treatment the calendar gives this
                course's blocks, so the two read as one colour code. */}
            <summary
              className="cursor-pointer px-3 py-2"
              style={{
                background: `var(--course-${slot}-bg)`,
                boxShadow: `inset 3px 0 0 0 var(--course-${slot}-accent)`,
              }}
            >
              <span className="text-sm font-medium text-foreground">{group.code}</span>
              <span className="ml-2 text-xs text-text-secondary">{group.title}</span>
              <span className="ml-2 text-xs text-text-tertiary">
                ({group.sections.length})
              </span>
              <CourseHeaderActions
                code={group.code}
                slot={slot}
                onInfo={onInfo ? () => onInfo(group.courseId) : undefined}
                onDock={onDock ? () => onDock(group.courseId) : undefined}
              />
            </summary>

            <ul className="border-t border-border">
              {group.sections.map((section) => {
                const isCurrent = section.sectionId === currentSectionId;
                const added = addedIds.has(section.sectionId);
                const label = isCurrent ? 'Current' : added ? 'Added' : actionLabel;
                return (
                  <li
                    key={section.sectionId}
                    className="flex items-start justify-between gap-2 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{section.sectionCode}</p>
                      <p className="text-xs text-text-secondary">{section.activity ?? '—'}</p>
                      <p className="text-xs text-text-tertiary">{section.meetings}</p>
                      {section.instructors.length > 0 && (
                        <p className="truncate text-xs text-text-tertiary">
                          {section.instructors.join(', ')}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={isCurrent || added}
                      onClick={() => onAdd(section)}
                      aria-label={`${label} ${group.code} ${section.sectionCode}`}
                      className="shrink-0 rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
          );
        })}
      </div>
    </div>
  );
}
