import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { MAX_ASSESSMENT_ROWS, normalizeSavedAssessment } from '@/syllabus/schema';

/**
 * The confirm screen's Save action - the only place a SyllabusAssessment row
 * is ever written, whether the rows came from an extraction the student just
 * accepted or from the student reopening their saved rows and correcting one.
 * The extract route (src/app/api/syllabus/extract/route.ts) only proposes
 * rows; nothing is persisted until a student accepts them here.
 *
 * Re-validated server-side by running the client's payload back through
 * normalizeSavedAssessment (schema.ts) - one copy of those rules, not a
 * hand-rolled duplicate - with the `edited` flag and date coercion layered
 * on top of what it returns.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { id } = await params;
  const syllabus = await db.syllabus.findUnique({ where: { id } });
  if (!syllabus || syllabus.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const rows = body?.assessments;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'Missing assessments.' }, { status: 400 });
  }
  // Rejected, not truncated: a save that silently kept the first 100 and
  // dropped the rest would report ok for a list the student never saw.
  if (rows.length > MAX_ASSESSMENT_ROWS) {
    return NextResponse.json(
      { error: `That is more than ${MAX_ASSESSMENT_ROWS} assessments, which is the most one syllabus can hold.` },
      { status: 400 },
    );
  }

  // Validated one row at a time, so each surviving row can be paired with its
  // own flags with no index bookkeeping: a list where a bad row is dropped
  // mid-array would desync any mapping done by position.
  const clean = rows.flatMap((raw) => {
    const a = normalizeSavedAssessment(raw);
    if (!a) return [];
    return [{
      title: a.title,
      kind: a.kind,
      date: a.date ? new Date(a.date) : null,
      startTime: a.startTime,
      weight: a.weight,
      quote: a.quote,
      page: a.page,
      // Decided by normalizeSavedAssessment, not by the client alone: a row
      // the student typed is their work by definition. mergeExams
      // (src/schedule/exams.ts) reads this to keep an edited final on the
      // page beside UBC's, where an untouched one would be dropped.
      editedByUser: a.editedByUser,
    }];
  });

  // Wipe-and-replace: a Save is the confirmed state of this syllabus's
  // assessment list, not a merge with whatever an earlier extraction saved.
  // Scoped to `syllabusId`, so the exams this student typed into the exam view
  // for the same course - standalone rows, syllabusId null - are not part of
  // what a syllabus save replaces.
  // The payload is the whole list the student was just looking at (their
  // saved rows when they opened the editor, the proposals when they ran an
  // extraction), so replacing is what they asked for. The one case where that
  // costs them something - re-extracting over rows they had corrected - is
  // warned about before the extraction runs, in AssessmentConfirm.
  await db.$transaction([
    db.syllabusAssessment.deleteMany({ where: { syllabusId: id } }),
    db.syllabusAssessment.createMany({
      // Owner, course and term are copied onto every row from the syllabus
      // it came off: a row carries its own now, so nothing has to join back
      // through here to find out whose it is.
      data: clean.map((c) => ({
        ...c,
        syllabusId: id,
        userId: syllabus.userId,
        courseId: syllabus.courseId,
        termId: syllabus.termId,
      })),
    }),
    db.syllabus.update({ where: { id }, data: { extractedAt: new Date() } }),
  ]);

  return NextResponse.json({ ok: true, count: clean.length });
}
