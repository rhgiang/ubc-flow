import { groupExams, type ExamCoverage, type ExamListItem } from '@/schedule/exams';
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

/** "Surnames ADI–SUN" - an en dash, not the hyphen UBC's table uses. */
export function formatAlphaSplit(alphaSplit: string): string {
  return `Surnames ${alphaSplit.replace('-', '–')}`;
}

/** Where a row came from, in the one line both the card and the overlay use. */
export function sourceLabel(item: ExamListItem): string {
  return item.source === 'ubc'
    ? 'UBC exam schedule'
    : 'From your syllabus. Double-check this date.';
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
      one is yours - check your section code, only one of these is your exam.
    </p>
  );
}

/** Click target for an exam, shared by the list and the calendar. */
export type SelectExam = (group: ExamListItem[]) => void;

/** Remove target, same shape. Absent when removing is not offered. */
export type RemoveExam = (group: ExamListItem[]) => void;

/**
 * The hover x that removes an exam without opening the detail overlay.
 *
 * Hidden until hover or keyboard focus on pointer devices, always visible on
 * touch, which has no hover at all: an affordance that only appears on hover
 * does not exist on a phone. It is a real button with a label rather than a
 * glyph, and it sits ABOVE the card's own click target so the two do not
 * fight, which is also why the card is no longer a <button> wrapping its
 * content. A button inside a button is invalid and breaks keyboard order.
 */
export function RemoveExamButton({
  group,
  onRemove,
  className = '',
}: {
  group: ExamListItem[];
  onRemove: RemoveExam;
  className?: string;
}) {
  const scraped = group[0].source === 'ubc';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove(group);
      }}
      aria-label={`${scraped ? 'Hide' : 'Remove'} ${group[0].courseLabel}`}
      title={scraped ? 'Hide this exam' : 'Remove this exam'}
      className={`absolute z-20 grid place-items-center rounded-full bg-surface-muted text-text-tertiary opacity-100 transition hover:bg-danger hover:text-brand-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 ${className}`}
    >
      <span aria-hidden="true">x</span>
    </button>
  );
}

/**
 * One exam's card - which may be several published rows when the exam is split
 * across rooms. Matches the visual language of EnrolledCourseCard: same
 * rounded-card/border/surface shell, same accent-on-code + secondary-title
 * header pattern - but the accent is the COURSE's colour, the same slot
 * ScheduleCalendar paints its blocks with, so an exam reads as the same course
 * it is everywhere else in the app.
 */
function ExamRow({
  group,
  onSelect,
  onRemove,
}: {
  group: ExamListItem[];
  onSelect?: SelectExam;
  onRemove?: RemoveExam;
}) {
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
          {item.location ?? 'Location TBA. Check with your instructor.'}
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

  if (!onSelect && !onRemove) {
    return (
      <div className={shell} style={bar}>
        {card}
      </div>
    );
  }

  return (
    <div className={`${shell} group relative`} style={bar}>
      {/* The card's own click target is a stretched button UNDER the content
          rather than a button wrapping it, so the x can sit above it as its
          own control. The content is inert so clicks fall through. */}
      {onSelect && (
        <button
          type="button"
          onClick={() => onSelect(group)}
          aria-label={`${group[0].courseLabel} exam details`}
          className="absolute inset-0 z-0 rounded-card transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted"
        />
      )}
      <div className="pointer-events-none relative z-10">{card}</div>
      {onRemove && <RemoveExamButton group={group} onRemove={onRemove} className="right-2 top-2 h-6 w-6 text-sm" />}
    </div>
  );
}

export default function ExamList({
  items,
  onSelect,
  onRemove,
}: {
  items: ExamListItem[];
  onSelect?: SelectExam;
  onRemove?: RemoveExam;
}) {
  if (items.length === 0) {
    // Whether UBC has published this term's schedule is ExamCoverageNote's
    // job, directly below - repeating it here said it twice on an empty tab.
    return (
      <p className="text-sm text-text-secondary">
        Nothing here yet. Midterms show up once you upload a syllabus.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groupExams(items).map((group) => (
        <ExamRow key={group[0].id} group={group} onSelect={onSelect} onRemove={onRemove} />
      ))}
    </div>
  );
}

/**
 * The difference between "this course has no final" and "UBC hasn't said yet",
 * which the page otherwise renders as the same blank space - and which mean
 * opposite things to someone deciding whether to keep a December flight.
 *
 * See `examCoverage` for how that call is made. Deliberately small and below
 * the exams themselves: it is a footnote to the list, not the headline.
 */
/**
 * The one sentence for "UBC has posted nothing for this term yet", shared by
 * the tab's empty state and the coverage footnote so the two cannot drift.
 * It tells the student what to do (check back) and when (partway through
 * term), which "nothing here yet" never did.
 */
export function NoFinalsPostedYet() {
  return (
    <>
      No final exams have been posted for this term yet. UBC usually publishes the
      schedule partway through term, so check back later.
    </>
  );
}

export function ExamCoverageNote({ coverage }: { coverage: ExamCoverage }) {
  if (!coverage.published) {
    return (
      <p className="mt-4 rounded-card border border-border bg-surface-muted px-3 py-2 text-xs text-text-secondary">
        <NoFinalsPostedYet /> Until it does, we can&apos;t tell you which of your
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
        {coverage.noFinal.length === 1 ? 'is' : 'are'} not in it. No registrar-scheduled
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
