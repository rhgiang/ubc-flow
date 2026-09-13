import type { ExamCoverage, ExamListItem } from '@/schedule/exams';
import { courseColorIndex } from '@/schedule/colors';

/**
 * Exam dates are stored as UTC midnight (src/scrape/jobs/exams.ts,
 * src/app/api/syllabus/[id]/assessments/route.ts), so they must be READ back
 * in UTC. Without an explicit zone this formats in the runtime's, and every
 * date west of Greenwich renders a day early ("Mon, Aug 17" for
 * 2026-08-18T00:00:00Z in America/Vancouver).
 * Exported for tests/exam-view.test.ts and for the detail overlay.
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
export function formatAlphaSplit(alphaSplit: string): string {
  return `Surnames ${alphaSplit.replace('-', '–')}`;
}

/** Where a row came from, in the one line both the card and the overlay use. */
export function sourceLabel(item: ExamListItem): string {
  return item.source === 'ubc'
    ? 'UBC exam schedule'
    : 'From your syllabus — double-check this date';
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
 * Shown on every row of a course that published several exam sections when we
 * can't tell which is the student's (see `filterToOwnSection`). Without it the
 * two cards read as "you have two PHIL 347 finals", and picking one for them
 * would be worse: the sections sit in different rooms at different times.
 * Exported for the detail overlay, which says the same thing.
 */
export function AmbiguousSectionNote() {
  return (
    <p className="mt-1 rounded-input border border-border bg-surface-muted px-2 py-1 text-xs text-text-secondary">
      UBC scheduled more than one section of this course, and we don&apos;t know which
      one is yours — check your section code, only one of these is your exam.
    </p>
  );
}

/** Click target for an exam, shared by the list and the calendar. */
export type SelectExam = (group: ExamListItem[]) => void;

/**
 * One exam's card — which may be several published rows when the exam is split
 * across rooms. Matches the visual language of EnrolledCourseCard: same
 * rounded-card/border/surface shell, same accent-on-code + secondary-title
 * header pattern — but the accent is the COURSE's colour, the same slot
 * ScheduleCalendar paints its blocks with, so an exam reads as the same course
 * it is everywhere else in the app.
 */
function ExamRow({ group, onSelect }: { group: ExamListItem[]; onSelect?: SelectExam }) {
  const item = group[0];
  const slot = courseColorIndex(item.courseLabel);
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

  const card = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium" style={{ color: `var(--course-${slot}-accent)` }}>
          {item.courseLabel}
        </span>
        {item.sectionCode && (
          <span className="text-sm text-text-tertiary">Section {item.sectionCode}</span>
        )}
      </div>
      <p className="text-xs text-text-tertiary">{sourceLabel(item)}</p>
      {/* Outside the cancelled strike-through below: it says this card may not
          be the student's exam at all, which is not a detail of the exam. */}
      {item.ambiguousSection && <AmbiguousSectionNote />}
      {item.cancelled ? (
        <div className="mt-1 line-through decoration-2 opacity-70">{body}</div>
      ) : (
        <div className="mt-1">{body}</div>
      )}
    </>
  );

  // The saturated left bar is ScheduleCalendar's block treatment, so the same
  // course is the same colour in the timetable and in this list.
  const shell = 'rounded-card border border-border bg-surface p-4';
  const bar = { boxShadow: `inset 3px 0 0 0 var(--course-${slot}-accent)` };

  if (!onSelect) {
    return (
      <div className={shell} style={bar}>
        {card}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(group)}
      style={bar}
      className={`${shell} block w-full text-left transition-colors hover:bg-surface-muted`}
    >
      {card}
    </button>
  );
}

export default function ExamList({
  items,
  onSelect,
}: {
  items: ExamListItem[];
  onSelect?: SelectExam;
}) {
  if (items.length === 0) {
    // Whether UBC has published this term's schedule is ExamCoverageNote's
    // job, directly below — repeating it here said it twice on an empty tab.
    return (
      <p className="text-sm text-text-secondary">
        Nothing here yet. Midterms show up once you upload a syllabus.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groupExams(items).map((group) => (
        <ExamRow key={group[0].id} group={group} onSelect={onSelect} />
      ))}
    </div>
  );
}

/**
 * The difference between "this course has no final" and "UBC hasn't said yet",
 * which the page otherwise renders as the same blank space — and which mean
 * opposite things to someone deciding whether to keep a December flight.
 *
 * See `examCoverage` for how that call is made. Deliberately small and below
 * the exams themselves: it is a footnote to the list, not the headline.
 */
export function ExamCoverageNote({ coverage }: { coverage: ExamCoverage }) {
  if (!coverage.published) {
    return (
      <p className="mt-4 rounded-card border border-border bg-surface-muted px-3 py-2 text-xs text-text-secondary">
        UBC hasn&apos;t published this term&apos;s final exam schedule yet — it usually
        appears partway through term. Until it does, we can&apos;t tell you which of your
        courses have a final.
      </p>
    );
  }

  if (coverage.noFinal.length === 0) return null;

  return (
    <div className="mt-4 rounded-card border border-border bg-surface-muted px-3 py-2">
      <p className="text-xs text-text-secondary">
        UBC&apos;s schedule for this term is out, and{' '}
        {coverage.noFinal.map((label, i) => (
          <span key={label}>
            {i > 0 && (i === coverage.noFinal.length - 1 ? ' and ' : ', ')}
            <span className="font-medium text-foreground">{label}</span>
          </span>
        ))}{' '}
        {coverage.noFinal.length === 1 ? 'is' : 'are'} not in it — no registrar-scheduled
        final exam.
      </p>
      {/* The honest caveat: the registrar's table only covers sit-down exams it
          books rooms for. A take-home or an online final never appears in it. */}
      <p className="mt-1 text-xs text-text-tertiary">
        An online or take-home final wouldn&apos;t appear there, so check your syllabus
        before you book anything.
      </p>
    </div>
  );
}
