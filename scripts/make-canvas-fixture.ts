/**
 * Reads a REAL Canvas calendar feed and writes a redacted fixture with the
 * same structure but a fabricated term. Sibling of make-fixture.ts, which
 * does the same for a Workday export.
 *
 *   npx tsx scripts/make-canvas-fixture.ts real.ics tests/fixtures/canvas-feed.ics
 *
 * Never commit its input. A raw feed names the student's actual courses,
 * every assignment they owe, and their instructors' full assignment briefs,
 * which is a term's worth of personal detail even with the owner's name
 * removed.
 *
 * What is preserved, because the parser tests exist to pin exactly these:
 *   - the VEVENT count, and the count of all-day versus timed
 *   - Canvas's doubled `DTSTART;VALUE=DATE;VALUE=DATE:` parameter
 *   - the `event-assignment-override-<n>` uid shape for a per-section date
 *   - every DTSTART and DTEND value, byte for byte
 *   - line folding at 75 octets, including SUMMARY folded mid-bracket
 *   - the trailing `[COURSE SECTIONS TERM]` on every SUMMARY
 *   - the count of distinct courses
 *
 * What is replaced: course codes, assignment titles, description bodies,
 * numeric ids in uids and URLs, and the calendar owner.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Fabricated courses, in the shapes UBC's Canvas actually emits: a single
 *  section, a slash-joined cross-listing, and a lettered section. */
const FAKE_COURSES = [
  'ASTR_V 101 001 2026W1',
  'HIST_V 102 101/102/103 2026W1',
  'PHIL_V 120 12A 2026W1',
  'GEOG_V 122 004/005 2026W1',
  'MUSC_V 103 002 2026W1',
];

/** Title shapes seen in a real feed: a plain one, a prefixed one, one that
 *  repeats its own section in brackets, and a shouted one. */
const TITLE_SHAPES = [
  (n: number) => `Problem Set ${n}`,
  (n: number) => `Pre-class: Reading Response ${n}`,
  (n: number) => `worksheet_topic_${n}`,
  (n: number) => `Quiz ${n}: Concepts and Applications`,
  (n: number) => `#${n} ASSIGNMENT`,
  (n: number) => `Writing Exercise: Draft ${n}`,
];

const LOREM =
  'Submit your work through the assignment page before the deadline. Late ' +
  'submissions are handled under the policy in the course syllabus. Read ' +
  'the rubric before you start, and bring questions to office hours. This ' +
  'text stands in for the instructor prose a real feed carries, at a ' +
  'similar length so the folding behaves the same way.';

/** RFC 5545 folds at 75 octets, continuation lines starting with one space.
 *  The parser's unfolder is the thing under test, so the fixture has to fold
 *  the same way a real feed does. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  out.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 0) {
    out.push(' ' + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  return out.join('\r\n');
}

function main() {
  const [, , input, output] = process.argv;
  if (!input || !output) throw new Error('usage: make-canvas-fixture <input.ics> <output.ics>');

  // Unfold first so each property is one logical line to rewrite.
  const raw = readFileSync(input, 'utf8').replace(/\r?\n[ \t]/g, '');
  const lines = raw.split(/\r?\n/);

  const courseMap = new Map<string, string>();
  let eventIndex = 0;
  let idSeed = 2500000;
  const out: string[] = [];

  for (const line of lines) {
    if (line.startsWith('X-WR-CALNAME')) {
      out.push('X-WR-CALNAME:Test Student Calendar (Canvas)');
      continue;
    }
    if (line.startsWith('X-WR-CALDESC')) {
      out.push('X-WR-CALDESC:Calendar events for the user\\, Test Student');
      continue;
    }
    // Instructor prose, wholesale. Kept as a property so the folding and the
    // escaped commas still exercise the reader.
    if (line.startsWith('DESCRIPTION') || line.startsWith('X-ALT-DESC')) {
      const name = line.slice(0, line.indexOf(':'));
      out.push(fold(`${name}:${LOREM.replace(/,/g, '\\,')}`));
      continue;
    }
    if (line.startsWith('UID:')) {
      eventIndex += 1;
      const isOverride = line.includes('override');
      idSeed += 37;
      out.push(`UID:event-assignment-${isOverride ? 'override-' : ''}${idSeed}`);
      continue;
    }
    if (line.startsWith('URL')) {
      // Keep the property shape and host; the course id is an identifier.
      out.push(`URL;VALUE=URI:https://canvas.ubc.ca/calendar?include_contexts=course_${100000 + (eventIndex % FAKE_COURSES.length) * 111}`);
      continue;
    }
    if (line.startsWith('SUMMARY')) {
      const bracket = line.match(/\[([^\]]*)\]\s*$/);
      const realCourse = bracket ? bracket[1] : '';
      if (realCourse && !courseMap.has(realCourse)) {
        courseMap.set(realCourse, FAKE_COURSES[courseMap.size % FAKE_COURSES.length]);
      }
      const fakeCourse = courseMap.get(realCourse) ?? FAKE_COURSES[0];
      const shape = TITLE_SHAPES[eventIndex % TITLE_SHAPES.length];
      out.push(fold(`SUMMARY:${shape(eventIndex)} [${fakeCourse}]`));
      continue;
    }
    // DTSTART, DTEND, DTSTAMP, SEQUENCE, CLASS, BEGIN, END and the calendar
    // header pass through untouched: they carry the shapes under test and
    // name nobody.
    out.push(line);
  }

  writeFileSync(output, out.join('\r\n'));
  console.log(`wrote ${output}`);
  console.log(`  events: ${eventIndex}`);
  console.log(`  courses: ${courseMap.size} ->`, [...courseMap.values()]);
}

main();
