import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { ASSESSMENT_KINDS, type AssessmentKind } from '@/syllabus/schema';

/**
 * The confirm screen's Save action — the only place a SyllabusAssessment row
 * is ever written. The extract route (src/app/api/syllabus/extract/route.ts)
 * only proposes rows; nothing is persisted until a student accepts them here.
 *
 * Re-validated server-side with the same rules normalizeAssessments applies
 * (schema.ts) — the client is trusted to render honestly, not to enforce
 * these on its own before POSTing.
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

  const clean: {
    title: string;
    kind: AssessmentKind;
    date: Date | null;
    startTime: string | null;
    weight: number | null;
    quote: string;
    page: number;
    editedByUser: boolean;
  }[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.title !== 'string' || r.title.trim() === '') continue;
    if (!ASSESSMENT_KINDS.includes(r.kind as AssessmentKind)) continue;
    if (typeof r.quote !== 'string' || r.quote.trim() === '') continue;
    if (!Number.isInteger(r.page)) continue;

    clean.push({
      title: r.title.trim(),
      kind: r.kind as AssessmentKind,
      date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? new Date(r.date) : null,
      startTime: typeof r.startTime === 'string' && /^\d{2}:\d{2}$/.test(r.startTime) ? r.startTime : null,
      weight: typeof r.weight === 'number' && Number.isFinite(r.weight) ? r.weight : null,
      quote: r.quote.trim(),
      page: r.page as number,
      editedByUser: r.edited === true,
    });
  }

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
