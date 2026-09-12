import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { extractAssessments } from '@/syllabus/extract';

// Opus 5 over a multi-page PDF, non-streaming, is the only long-running route
// in this repo — the platform's default function timeout would otherwise
// kill it mid-call: billed, quota already spent, student gets nothing.
export const maxDuration = 300;

// Real money per call (~5c/syllabus, pending a real measurement now that
// output_config.effort is set — see extract.ts and
// docs/superpowers/specs/2026-09-12-syllabus-and-exams-design.md §8), and
// nothing else in this repo rate-limits a route: an uncapped one is an
// unbounded billing vector against a compromised or scripted account. Counts
// ATTEMPTS, not confirmed extractions — Syllabus.extractedAt is only set by
// the save route (src/app/api/syllabus/[id]/assessments/route.ts), so it
// can't gate the expensive call itself. A plain fixed-window counter on User
// is enough for a per-account daily quota; no new table needed. Fixed, not
// sliding: it resets at whenever the first request after expiry lands, so
// e.g. 8 calls at t+23:59 and 8 more at t+24:01 is possible — bounded, and
// not worth a real sliding window for an abuse guard.
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

  let blob;
  try {
    blob = await get(syllabus.pathname, { access: 'private' });
  } catch {
    return NextResponse.json({ error: 'Could not read that file.' }, { status: 500 });
  }
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // Cap enforced here: after we know there's a real file to send (a missing
  // or corrupt blob shouldn't cost a quota unit), before the paid Anthropic
  // call. Atomic increment-with-cap-check: each branch's `where` re-encodes
  // the condition it depends on (not just `id`), so Postgres re-evaluates it
  // against the latest committed row when two concurrent requests contend
  // for the same one — the loser's WHERE fails against the winner's already-
  // written row and it gets count: 0 back, instead of both reading "under
  // the limit" before either writes and both slipping through. Two
  // updateManys (window-expired vs. not) rather than one read + one write.
  const now = new Date();
  const windowCutoff = new Date(now.getTime() - DAY_MS);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { extractionWindowStart: true },
  });
  const windowExpired = !user?.extractionWindowStart || user.extractionWindowStart < windowCutoff;
  const capUpdate = windowExpired
    ? await db.user.updateMany({
        where: {
          id: userId,
          OR: [{ extractionWindowStart: null }, { extractionWindowStart: { lt: windowCutoff } }],
        },
        data: { extractionCount: 1, extractionWindowStart: now },
      })
    : await db.user.updateMany({
        where: { id: userId, extractionCount: { lt: EXTRACTIONS_PER_DAY } },
        data: { extractionCount: { increment: 1 } },
      });
  if (capUpdate.count === 0) {
    return NextResponse.json(
      {
        error: `You've hit today's limit of ${EXTRACTIONS_PER_DAY} syllabus extractions. `
          + 'Try again tomorrow.',
      },
      { status: 429 },
    );
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
