/**
 * Exam logic with no database in it, on purpose. ExamList and ExamActions are
 * client components and import `groupExams` from here; a `@/lib/db` import
 * anywhere in this file drags pg into the browser bundle and the build fails
 * on `dns`. The three queries live in ./exam-queries.ts.
 */

/**
 * One exam on the exams tab of /schedule. A union on `source`: scraped finals
 * (`ubc`) and the rows a student confirmed from a syllabus or typed by hand
 * (`syllabus`) render through the same shape, and `mergeExams` joins them.
 */
export type ExamListItem = {
  id: string;
  courseLabel: string; // "BIOC 302"
  sectionCode: string;
  date: Date | null;
  startTime: string | null;
  location: string | null; // "BIOL 1000", null when unknown
  alphaSplit: string | null;
  notes: string | null;
  cancelled: boolean;
  source: 'ubc' | 'syllabus';
  /** Set on syllabus rows a student edited or typed by hand. `mergeExams`
   *  keeps such a final beside UBC's instead of dropping it. */
  editedByUser?: boolean;
  /** Which kind of exam this is. `mergeExams` and `groupExams` both key on
   *  it, so this field is load-bearing. */
  kind: 'final' | 'midterm';
  /** Set when the course published several exam sections and we could not tell
   *  which one is the student's - see `filterToOwnSection`. Every section is
   *  shown, and the flag is what stops that reading as "you have two exams". */
  ambiguousSection?: boolean;
};

/** Shape `examRowsForUser` assembles by hand - `FinalExam` has no Prisma
 *  relation to `Course` (raw FK, same convention as the rest of this schema),
 *  so the join happens in JS rather than via `include`. */
type FinalExamRow = {
  id: string;
  sectionCode: string;
  date: Date | null;
  startTime: string | null;
  building: string | null;
  room: string | null;
  alphaSplit: string | null;
  notes: string | null;
  cancelled: boolean;
  course: { number: string; subject: { code: string | null } };
};

/** "BIOC" from "BIOC_V": the scrape and Workday spellings carry a campus
 *  suffix that `Subject.code` and a student's eyes do not. */
export function stripCampusSuffix(subjectCode: string): string {
  return subjectCode.replace(/_[A-Z]$/, '');
}

/** "BIOC 302" - the one spelling every exam consumer keys on: the exam rows,
 *  the coverage check, the section filter and the scrape job's skipped list.
 *  Trimmed so a subject with no code still compares equal to itself. */
export function courseLabel(course: { number: string; subject: { code: string | null } }): string {
  return `${course.subject.code ? stripCampusSuffix(course.subject.code) : ''} ${course.number}`.trim();
}

/** Pure: a scraped `FinalExam` row (joined with its course/subject) into the
 *  shape the exam view renders. Every row this produces is `kind: 'final'` -
 *  syllabus-derived midterms are a later task. */
export function toExamListItem(row: FinalExamRow): ExamListItem {
  return {
    id: row.id,
    courseLabel: courseLabel(row.course),
    sectionCode: row.sectionCode,
    date: row.date,
    startTime: row.startTime,
    location: row.building ? `${row.building}${row.room ? ` ${row.room}` : ''}` : null,
    alphaSplit: row.alphaSplit,
    notes: row.notes,
    cancelled: row.cancelled,
    source: 'ubc',
    kind: 'final',
  };
}

/** Sort key: dated, live exams first (ascending by date then start time);
 *  cancelled and dateless rows sink to the bottom regardless of date. */
function sortKey(item: ExamListItem): [number, number, string] {
  if (item.cancelled || !item.date) return [1, 0, ''];
  return [0, item.date.getTime(), item.startTime ?? ''];
}

export function compareItems(a: ExamListItem, b: ExamListItem): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
}

/** Section codes are compared, never displayed, through this: the exam table
 *  and a Workday export are two different transcriptions of the same string. */
function sameSection(a: string): string {
  return a.trim().toUpperCase();
}

/**
 * UBC splits a big exam across rooms by surname, publishing one row per room.
 * Those rows are the SAME exam, and rendering them as separate cards reads as
 * "you have two BIOL 121 exams" - which is how the first person to see this
 * page read it. Group them so one exam is one card, listing each room against
 * the surnames that go to it.
 *
 * The key deliberately excludes alphaSplit, building and room - those are what
 * differ WITHIN a group. Two genuinely separate exams for one course (a
 * midterm and a final, or two midterms) differ by kind or date and stay apart.
 */
export function groupKey(item: ExamListItem): string {
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

/** Section codes published per course, compared through `sameSection`. */
function sectionsByCourse(items: ExamListItem[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const i of items) {
    const seen = out.get(i.courseLabel) ?? new Set<string>();
    seen.add(sameSection(i.sectionCode));
    out.set(i.courseLabel, seen);
  }
  return out;
}

/**
 * Drops the other sections' exams, and the rows this student has hidden.
 *
 * `Enrollment` carries no section, so the course+term join brings back every
 * published section of a course - and 8 of the 108 courses in UBC's table
 * publish more than one (PHIL_V 347 001/002, ENGL_V 110 JL1/JL2, LAW_V 505
 * 98A/98B). A student in one of them was shown both exams, at different times
 * in different buildings, with nothing saying which was theirs.
 *
 * `lectureSectionByCourse` is their own section per course label, from their
 * Workday import - the LECTURE one only. A lab's "L1U" or a tutorial's "T2M"
 * is not an exam section and would match nothing.
 *
 * Three cases, in order of how much we know:
 *   - Their lecture section is one UBC published for the course: only that
 *     one. Judged against what UBC PUBLISHED, hidden rows included: hiding
 *     removes rows from view, it never changes what counts as published. The
 *     bug this guards: a student in 001 hides 001 by accident; if the count
 *     came from the post-hide rows, 002 would be the course's only section
 *     and show unflagged as theirs, when before the hide it was filtered out.
 *     Now hiding your own section leaves the course empty (it is still in
 *     the hidden list, and still counts as covered).
 *   - One visible section, theirs unknown: nothing to choose between.
 *     Untouched - the overwhelming majority, and a no-op. Counted AFTER
 *     hiding on purpose, so a student who cannot tell us their section and
 *     hides the one that is not theirs stops being asked which is which.
 *   - Several visible, and we don't know theirs (never imported Workday) or
 *     it matches none of them: ALL of them, flagged `ambiguousSection`.
 *     Guessing sends someone to the wrong room; hiding one loses a real exam.
 *     Neither is worth saving them a glance at a label.
 *
 * `alphaSplit` is a different axis: rows sharing a `sectionCode` are ONE exam
 * in several rooms, and they pass through together - grouping them is
 * `groupExams`' job, downstream of this.
 */
export function filterToOwnSection(
  items: ExamListItem[],
  lectureSectionByCourse: Map<string, string>,
  hiddenIds: Set<string> = new Set(),
): ExamListItem[] {
  const published = sectionsByCourse(items);
  const visible = withoutHidden(items, hiddenIds);
  const visibleSections = sectionsByCourse(visible);

  return visible.flatMap((item) => {
    const mine = lectureSectionByCourse.get(item.courseLabel);
    const mineCode = mine ? sameSection(mine) : null;
    if (mineCode && published.get(item.courseLabel)!.has(mineCode)) {
      return sameSection(item.sectionCode) === mineCode ? [item] : [];
    }
    if (visibleSections.get(item.courseLabel)!.size < 2) return [item];
    return [{ ...item, ambiguousSection: true }];
  });
}

/**
 * Drops the scraped rows this student has hidden.
 *
 * A `FinalExam` is global - one row per published exam, read by every student
 * in the course - so "remove this from my exams" is a per-user marker
 * (`HiddenFinalExam`), never a delete. This is where the marker is applied,
 * and it is applied inside `filterToOwnSection` from `examRowsForUser`, so
 * that every consumer gets it: the page, the shared page, and the subscribed
 * ICS feed.
 *
 * Syllabus rows are never in this set: those belong to the student and are
 * deleted outright, so there is nothing to hide.
 */
export function withoutHidden(items: ExamListItem[], hiddenIds: Set<string>): ExamListItem[] {
  return items.filter((i) => i.source !== 'ubc' || !hiddenIds.has(i.id));
}

/**
 * Merges scraped finals with syllabus-derived rows into one list.
 *
 * NOTHING EVER DISPLACES A SCRAPED ROW. Every `FinalExam` row passes through
 * untouched, whatever the syllabus rows say. Two rules that guessed otherwise
 * each produced a hidden real exam on this branch:
 *   - keying scraped rows per course kept whichever came last, so an alpha
 *     split (CHEM 123: ADI-SUN in IRC 2, TAZ-ZHU in IRC 6) lost a room and a
 *     cancelled section overwrote the live one;
 *   - letting an edited or hand-typed syllabus final replace the scraped one
 *     meant a student who typed "CPSC 110 final, date TBA" in September never
 *     saw the row UBC published in November. The page said "Date TBA", the
 *     feed carried nothing, and nothing on screen said UBC disagreed. The same
 *     rule swallowed a cancellation notice.
 * When a syllabus or manual final sits beside a scraped final for the same
 * course, BOTH render, each labelled with its source, and the student can hide
 * UBC's if they truly disagree. One extra card beats a hidden exam.
 *
 * The only drop is in the other direction: a syllabus final the student did
 * NOT edit is dropped when UBC publishes a final for that course. That row is
 * the model reading "final exam, scheduled by the registrar" off a PDF, with
 * no date, and UBC's own schedule is authoritative over it. An edited or
 * hand-typed final (`editedByUser`) is kept: the student put that date there
 * on purpose, so it stays until they remove it.
 *
 * `kind: 'midterm'` rows only ever come from syllabi, there's nothing for
 * them to collide with, and a course usually has more than one, so every
 * midterm passes straight through.
 *
 * Reuses `compareItems` for the final sort rather than a second ordering.
 */
export function mergeExams(scraped: ExamListItem[], fromSyllabus: ExamListItem[]): ExamListItem[] {
  const coursesWithScrapedFinal = new Set(
    scraped.filter((i) => i.kind === 'final').map((i) => i.courseLabel),
  );
  const keptSyllabus = fromSyllabus.filter(
    (i) => i.kind !== 'final' || i.editedByUser || !coursesWithScrapedFinal.has(i.courseLabel),
  );
  return [...scraped, ...keptSyllabus].sort(compareItems);
}

/**
 * What the exam page can honestly say about a student's courses that have no
 * exam on it. Today it says nothing, and a student with six courses and four
 * exams cannot tell whether a course has NO final or whether its final simply
 * hasn't been published - opposite meanings rendered as the same blank space.
 *
 * The signal: UBC publishes a term's whole final exam schedule at once,
 * partway through term. So ONE `FinalExam` row anywhere in the term - any
 * course, not just this student's - proves the schedule is out, and an
 * enrolled course still missing from it has no registrar-scheduled final.
 * Before that first row nothing is known, and naming a course as having no
 * final would be the kind of lie that makes someone miss one.
 */
export type ExamCoverage =
  | { published: false }
  | { published: true; noFinal: string[] };

export function examCoverage(
  items: ExamListItem[],
  enrolledLabels: string[],
  termHasAnyExam: boolean,
): ExamCoverage {
  if (!termHasAnyExam) return { published: false };
  // A syllabus final counts as covered: the student has told us there IS one,
  // and naming the course below a card announcing it would contradict itself.
  // A cancelled row counts too - the registrar scheduled it and then pulled
  // it, which the struck-through card says better than this note could.
  // Midterms never count: they say nothing about whether a final exists.
  const withFinal = new Set(
    items.filter((i) => i.kind === 'final').map((i) => i.courseLabel),
  );
  return {
    published: true,
    noFinal: [...new Set(enrolledLabels)].filter((l) => !withFinal.has(l)).sort(),
  };
}

/**
 * Why the exam tab has nothing to show, so the empty state can say the one
 * thing that is actually true instead of "nothing here yet".
 *
 * These are different situations that look identical on screen and call for
 * different next steps:
 *   - no-term: no term in the catalogue is current. Not a student state, a
 *     data gap, and "check back later" would be wrong: waiting fixes nothing.
 *   - no-enrollments: nothing imported for this term. Telling this student to
 *     wait for UBC to publish is misdirection; they need to import Workday.
 *   - not-published: enrolled, but UBC has posted nothing for the term yet,
 *     for anyone. The only case where "check back later" is the right advice.
 * The order matters: each earlier reason makes the later message misleading.
 *
 * Null when there is something to render, or when the schedule IS out and the
 * student's courses simply are not in it; `examCoverage` names those below.
 */
export type ExamsEmptyReason = 'no-term' | 'no-enrollments' | 'not-published' | null;

export function examsEmptyReason(input: {
  termId: string | null;
  enrolledCount: number;
  itemCount: number;
  published: boolean;
}): ExamsEmptyReason {
  if (input.termId === null) return 'no-term';
  if (input.enrolledCount === 0) return 'no-enrollments';
  if (input.itemCount === 0 && !input.published) return 'not-published';
  return null;
}
