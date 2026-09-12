import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { extractAssessments } from '@/syllabus/extract';

// Real money per call (~5c/syllabus — see
// docs/superpowers/specs/2026-09-12-syllabus-and-exams-design.md §8), and
// nothing else in this repo rate-limits a route: an uncapped one is an
// unbounded billing vector against a compromised or scripted account. Counts
// ATTEMPTS, not confirmed extractions — Syllabus.extractedAt is only set by
// the save route (src/app/api/syllabus/[id]/assessments/route.ts), so it
// can't gate the expensive call itself. A plain sliding-window counter on
// User is enough for a per-account daily quota; no new table needed.
const EXTRACTIONS_PER_DAY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const syllabusId = body?.syllabusId;
  if (typeof syllabusId !== 'string' || !syllabusId) {
    return NextResponse.json({ error: 'Missing syllabusId.' }, { status: 400 });
  }

  // Same 404-for-both shape as src/app/api/syllabus/[id]/file/route.ts —
  // never confirm to a caller that another student's syllabus id is real.
  const syllabus = await db.syllabus.findUnique({ where: { id: syllabusId } });
  if (!syllabus || syllabus.userId !== userId) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // Cap enforced BEFORE the Anthropic call, not after.
  const now = new Date();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { extractionCount: true, extractionWindowStart: true },
  });
  const windowExpired = !user?.extractionWindowStart
    || now.getTime() - user.extractionWindowStart.getTime() > DAY_MS;
  const countSoFar = windowExpired ? 0 : user!.extractionCount;
  if (countSoFar >= EXTRACTIONS_PER_DAY) {
    return NextResponse.json(
      {
        error: `You've hit today's limit of ${EXTRACTIONS_PER_DAY} syllabus extractions. `
          + 'Try again tomorrow.',
      },
      { status: 429 },
    );
  }
  // ponytail: read-then-write, not atomic — two concurrent requests from the
  // same account could both slip in under the cap. Fine for an abuse guard
  // on a single user's own quota; add a DB-level increment if that matters.
  await db.user.update({
    where: { id: userId },
    data: windowExpired
      ? { extractionCount: 1, extractionWindowStart: now }
      : { extractionCount: { increment: 1 } },
  });

  let blob;
  try {
    blob = await get(syllabus.pathname, { access: 'private' });
  } catch {
    return NextResponse.json({ error: 'Could not read that file.' }, { status: 500 });
  }
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // Failure here must never touch the Syllabus row — it stays stored and
  // viewable, just not yet read (extractedAt stays null), with a retry.
  try {
    const pdf = Buffer.from(await new Response(blob.stream).arrayBuffer());
    const assessments = await extractAssessments(pdf);
    return NextResponse.json({ assessments });
  } catch {
    return NextResponse.json(
      { error: 'Could not read this syllabus right now. Try again in a moment.' },
      { status: 500 },
    );
  }
}
