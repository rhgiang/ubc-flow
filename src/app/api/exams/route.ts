import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { normalizeExamLocation, normalizeManualExam } from '@/syllabus/schema';

/**
 * Add and remove exams from the exam views.
 *
 * Removing is not symmetric, because the two sources are not:
 *   - a `SyllabusAssessment` is this student's row, so DELETE deletes it;
 *   - a `FinalExam` is scraped from UBC's public table and shared by everyone
 *     in the course, so DELETE only writes a `HiddenFinalExam` marker. PATCH
 *     takes that marker back off, which is the way back for someone who hid
 *     their real final by accident.
 *
 * `ids` is comma-separated because one exam is several rows when UBC splits it
 * across rooms by surname (see `groupExams`): the overlay removes the exam the
 * student is looking at, not one of its rooms.
 */

// A group is a handful of rooms at most; anything longer is not a group.
const MAX_IDS = 20;
// One term's worth of hand-typed exams. A student has a dozen; this is only
// here so a scripted client cannot write an unbounded table.
const MAX_MANUAL_EXAMS = 100;

function idsFrom(req: Request): string[] {
  const raw = new URL(req.url).searchParams.get('ids') ?? '';
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_IDS);
}

/** Adds one exam the student typed: a `SyllabusAssessment` with no syllabus. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const courseId = typeof body?.courseId === 'string' ? body.courseId : null;
  const termId = typeof body?.termId === 'string' ? body.termId : null;
  if (!courseId || !termId) {
    return NextResponse.json({ error: 'Missing courseId or termId.' }, { status: 400 });
  }

  // Same rules as every other row, whatever wrote it: a kind this app knows,
  // and here the two kinds that belong on an exam page. No quote and no page,
  // which is correct for this origin and this origin only - the quote rule
  // exists so a human can check MODEL output, and a row the student typed is
  // its own evidence.
  const exam = normalizeManualExam(body);
  if (!exam) {
    return NextResponse.json({ error: 'Pick a midterm or a final.' }, { status: 400 });
  }

  // Same bound as /api/syllabus: courseId is caller-supplied, and an exam for
  // a course you are not taking is meaningless.
  const enrollment = await db.enrollment.findFirst({
    where: { userId, courseId, termId },
    select: { id: true },
  });
  if (!enrollment) {
    return NextResponse.json({ error: "You're not enrolled in that course this term." }, { status: 403 });
  }

  const existing = await db.syllabusAssessment.count({
    where: { userId, termId, syllabusId: null },
  });
  if (existing >= MAX_MANUAL_EXAMS) {
    return NextResponse.json({ error: 'That is more exams than we can add for one term.' }, { status: 400 });
  }

  await db.syllabusAssessment.create({
    data: {
      // No syllabus to hang off, and none is invented for it: this row is the
      // student's own, and says so.
      syllabusId: null,
      userId,
      courseId,
      termId,
      title: exam.title,
      kind: exam.kind,
      // Stored as UTC midnight, like every other exam date - the views read
      // them back with timeZone: 'UTC'.
      date: exam.date ? new Date(`${exam.date}T00:00:00.000Z`) : null,
      startTime: exam.startTime,
      location: exam.location,
      weight: exam.weight,
      quote: null,
      page: null,
      editedByUser: true,
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * Sets where an exam is, for the student's own rows only.
 *
 * A `FinalExam` is UBC's row, shared by everyone in the course, so there is
 * nothing here to edit: one student typing a room would move it for the whole
 * class. Those rows are not writable and this says so rather than pretending.
 *
 * `ids` rather than one id, for the same reason DELETE takes a list: the
 * overlay edits the exam the student is looking at, which is a group.
 */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const ids = idsFrom(req);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Missing ids.' }, { status: 400 });
  }
  const body = await req.json().catch(() => null);

  // Scoped to this user in the WHERE, so someone else's row is simply not
  // found rather than refused - same reasoning as DELETE above.
  const { count } = await db.syllabusAssessment.updateMany({
    where: { id: { in: ids }, userId: session.user.id },
    data: { location: normalizeExamLocation(body?.location), editedByUser: true },
  });
  if (count === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, updated: count });
}

/** Removes an exam: deletes the student's own row, hides a scraped one. */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const userId = session.user.id;

  const ids = idsFrom(req);
  const source = new URL(req.url).searchParams.get('source');
  if (ids.length === 0 || (source !== 'ubc' && source !== 'syllabus')) {
    return NextResponse.json({ error: 'Missing ids or source.' }, { status: 400 });
  }

  if (source === 'syllabus') {
    // Scoped to the signed-in user in the delete itself, so someone else's row
    // is simply not found rather than refused - a 403 would confirm it exists.
    const { count } = await db.syllabusAssessment.deleteMany({ where: { id: { in: ids }, userId } });
    if (count === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, removed: count });
  }

  const found = await db.finalExam.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  // NOT a delete: this row is every classmate's exam too. skipDuplicates so
  // hiding an already-hidden exam is a no-op rather than an error.
  await db.hiddenFinalExam.createMany({
    data: found.map((f) => ({ userId, finalExamId: f.id })),
    skipDuplicates: true,
  });
  return NextResponse.json({ ok: true, removed: found.length });
}

/** Brings a hidden scraped exam back. */
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const ids = idsFrom(req);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Missing ids.' }, { status: 400 });
  }

  // Only this student's own markers, so there is nothing here to own but the
  // hiding itself. Idempotent: unhiding what is already visible changes
  // nothing and is not an error.
  const { count } = await db.hiddenFinalExam.deleteMany({
    where: { userId: session.user.id, finalExamId: { in: ids } },
  });
  return NextResponse.json({ ok: true, restored: count });
}
