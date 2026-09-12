import type { ExamListItem } from '@/schedule/exams';

/**
 * Exam dates are stored as UTC midnight (src/scrape/jobs/exams.ts,
 * src/app/api/syllabus/[id]/assessments/route.ts), so they must be READ back
 * in UTC. This is a server component: without an explicit zone it formats in
 * the runtime's, and every date west of Greenwich renders a day early
 * ("Mon, Aug 17" for 2026-08-18T00:00:00Z in America/Vancouver).
 * Exported for tests/exam-view.test.ts.
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Surnames ADI–SUN" — an en dash, not the hyphen UBC's table uses. */
function formatAlphaSplit(alphaSplit: string): string {
  return `Surnames ${alphaSplit.replace('-', '–')}`;
}

/**
 * UBC splits a big exam across rooms by surname, publishing one row per room.
 * Those rows are the SAME exam, and rendering them as separate cards reads as
 * "you have two BIOL 121 exams" — which is how the first person to see this
 * page read it. Group them so one exam is one card, listing each room against
 * the surnames that go to it.
 *
 * The key deliberately excludes alphaSplit, building and room — those are what
 * differ WITHIN a group. Two genuinely separate exams for one course (a
 * midterm and a final, or two midterms) differ by kind or date and stay apart.
 */
function groupKey(item: ExamListItem): string {
  return [
    item.courseLabel,
    item.kind,
    item.date ? item.date.toISOString() : 'no-date',
    item.startTime ?? 'no-time',
    item.source,
  ].join('|');
}

export function groupExams(items: ExamListItem[]): ExamListItem[][] {
  const groups = new Map<string, ExamListItem[]>();
  for (const item of items) {
    const key = groupKey(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

/**
 * One exam's card — which may be several published rows when the exam is split
 * across rooms. Matches the visual language of EnrolledCourseCard: same
 * rounded-card/border/surface shell, same accent-on-code + secondary-title
 * header pattern.
 */
function ExamRow({ group }: { group: ExamListItem[] }) {
  const item = group[0];
  const body = (
    <>
      <p className="text-sm text-text-secondary">
        {item.date ? formatDate(item.date) : 'Date TBA'}
        {item.startTime ? ` · ${item.startTime}` : ''}
      </p>
      {group.length === 1 ? (
        <p className="mt-1 text-sm text-text-secondary">
          {item.location ?? 'Location TBA — check with your instructor'}
          {item.alphaSplit ? ` · ${formatAlphaSplit(item.alphaSplit)}` : ''}
        </p>
      ) : (
        // One exam, several rooms. The surname range is the part that tells a
        // student which room is theirs, so it leads.
        <ul className="mt-1 space-y-0.5">
          {group.map((row) => (
            <li key={row.id} className="text-sm text-text-secondary">
              {row.alphaSplit ? `${formatAlphaSplit(row.alphaSplit)}: ` : ''}
              {row.location ?? 'Location TBA'}
            </li>
          ))}
        </ul>
      )}
      {item.notes && <p className="mt-1 text-sm text-text-tertiary">{item.notes}</p>}
    </>
  );

  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-brand-accent">{item.courseLabel}</span>
        {item.sectionCode && (
          <span className="text-sm text-text-tertiary">Section {item.sectionCode}</span>
        )}
      </div>
      <p className="text-xs text-text-tertiary">
        {item.source === 'ubc' ? 'UBC exam schedule' : 'From your syllabus — double-check this date'}
      </p>
      {item.cancelled ? (
        <div className="mt-1 line-through decoration-2 opacity-70">{body}</div>
      ) : (
        <div className="mt-1">{body}</div>
      )}
    </div>
  );
}

export default function ExamList({ items }: { items: ExamListItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        Nothing here yet. UBC publishes the final exam schedule partway through term, and
        midterms show up once you upload a syllabus.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groupExams(items).map((group) => (
        <ExamRow key={group[0].id} group={group} />
      ))}
    </div>
  );
}
