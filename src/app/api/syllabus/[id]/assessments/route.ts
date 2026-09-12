import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { normalizeAssessments } from '@/syllabus/schema';

/**
 * The confirm screen's Save action — the only place a SyllabusAssessment row
 * is ever written. The extract route (src/app/api/syllabus/extract/route.ts)
 * only proposes rows; nothing is persisted until a student accepts them here.
 *
 * Re-validated server-side by running the client's payload back through
 * normalizeAssessments (schema.ts) — one copy of those rules, not a
 * hand-rolled duplicate — with the `edited` flag and date coercion layered
 * on top of what it returns.
 */
const MAX_ASSESSMENT_ROWS = 100;

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

  // normalizeAssessments drops invalid rows, so mapping its output back onto
  // `rows` by index would desync as soon as anything mid-array gets dropped.
  // Run it one row at a time instead — still the single source of truth for
  // the validation rules, just called N times — so each surviving row can be
  // paired with its own `edited` flag with no index bookkeeping.
  // Authenticated, but still caller-supplied and headed straight into a bulk
  // insert. A real syllabus lists a dozen assessments; 100 is far past any
  // honest one and keeps a scripted client from writing an unbounded table.
  const clean = rows.slice(0, MAX_ASSESSMENT_ROWS).flatMap((raw) => {
    const [a] = normalizeAssessments({ assessments: [raw] });
    if (!a) return [];
    return [{
      title: a.title,
      kind: a.kind,
      date: a.date ? new Date(a.date) : null,
      startTime: a.startTime,
      weight: a.weight,
      quote: a.quote,
      page: a.page,
      editedByUser: (raw as Record<string, unknown>)?.edited === true,
    }];
  });

  // Wipe-and-replace: a Save is the confirmed state of this syllabus's
  // assessment list, not a merge with whatever an earlier extraction saved.
  await db.$transaction([
    db.syllabusAssessment.deleteMany({ where: { syllabusId: id } }),
    db.syllabusAssessment.createMany({
      data: clean.map((c) => ({ ...c, syllabusId: id })),
    }),
    db.syllabus.update({ where: { id }, data: { extractedAt: new Date() } }),
  ]);

  return NextResponse.json({ ok: true, count: clean.length });
}
