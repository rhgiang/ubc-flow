import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { extractAssessments } from '@/syllabus/extract';
import { termDateRange } from '@/schedule/terms';

// Opus 5 over a multi-page PDF, non-streaming, is the only long-running route
// in this repo - the platform's default function timeout would otherwise
// kill it mid-call: billed, quota already spent, student gets nothing.
export const maxDuration = 300;

// Real money per call (~5c/syllabus, pending a real measurement now that
// output_config.effort is set - see extract.ts and
// docs/superpowers/specs/2026-09-12-syllabus-and-exams-design.md §8), and
// nothing else in this repo rate-limits a route: an uncapped one is an
// unbounded billing vector against a compromised or scripted account. Counts
// ATTEMPTS, not confirmed extractions - Syllabus.extractedAt is only set by
// the save route (src/app/api/syllabus/[id]/assessments/route.ts), so it
// can't gate the expensive call itself. A plain fixed-window counter on User
// is enough for a per-account daily quota; no new table needed. Fixed, not
// sliding: it resets at whenever the first request after expiry lands, so
// e.g. 8 calls at t+23:59 and 8 more at t+24:01 is possible - bounded, and
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

  // Same 404-for-both shape as src/app/api/syllabus/[id]/file/route.ts -
  // never confirm to a caller that another student's syllabus id is real.
  const syllabus = await db.syllabus.findUnique({ where: { id: syllabusId } });
  if (!syllabus || syllabus.userId !== userId) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // A link is a bookmark, not a document: we never fetch it (it would return
  // a Canvas login page, which the model would happily invent midterms from),
  // so a row carrying only a url has nothing to read. Said plainly, with the
  // fix, rather than returning an empty assessment list - "no assessments
  // found" is indistinguishable from a real empty result.
  if (!syllabus.pathname && !syllabus.sourceText) {
    return NextResponse.json(
      {
        error: 'A link on its own is just a bookmark, we can\'t read it. Open the syllabus, '
          + 'select all, and paste the text in to get the midterm dates.',
      },
      { status: 400 },
    );
  }

  // The term is what turns "Oct 26" into a real date (see
  // src/syllabus/extract.ts). `Syllabus.termId` is a raw FK, same convention
  // as the rest of this schema, so it is fetched rather than included. A
  // syllabus whose term has gone is not a state a student can reach, and the
  // same 404 answers it as any other row we cannot serve.
  const term = await db.term.findUnique({ where: { id: syllabus.termId } });
  if (!term) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // The PDF wins when a course has both: it carries page numbers and survives
  // tables that a copy-paste flattens.
  let blob = null;
  if (syllabus.pathname) {
    try {
      blob = await get(syllabus.pathname, { access: 'private' });
    } catch {
      return NextResponse.json({ error: 'Could not read that file.' }, { status: 500 });
    }
    if (!blob || blob.statusCode !== 200) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
  }

  // Cap enforced here: after we know there's a real file or paste to send (a
  // missing or corrupt blob shouldn't cost a quota unit), before the paid Anthropic
  // call. Atomic increment-with-cap-check: each branch's `where` re-encodes
  // the condition it depends on (not just `id`), so Postgres re-evaluates it
  // against the latest committed row when two concurrent requests contend
  // for the same one - the loser's WHERE fails against the winner's already-
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

  // Failure here must never touch the Syllabus row - it stays stored and
  // viewable, just not yet read (extractedAt stays null), with a retry.
  try {
    const source = blob
      ? Buffer.from(await new Response(blob.stream).arrayBuffer())
      : syllabus.sourceText!;
    const assessments = await extractAssessments(source, termDateRange(term));
    return NextResponse.json({ assessments });
  } catch (e) {
    // The message only, never the syllabus content or who sent it. A missing
    // ANTHROPIC_API_KEY, a rate limit and a model outage are three different
    // problems that all reach the student as the same sentence; the server
    // needs to be able to tell them apart.
    console.error('syllabus extraction failed:', e instanceof Error ? e.message : e);

    // Give the quota unit back, the same way src/app/api/syllabus/route.ts
    // refunds a failed put(). The cap is charged before the call so that
    // concurrent requests cannot all pass the same check, but what it bounds
    // is paid Anthropic calls, and a call that threw is not one we were
    // billed for the way a completed one is. Without this a missing
    // ANTHROPIC_API_KEY in production burns a student's 8 a day on our
    // misconfiguration. A successful call that found nothing is NOT refunded:
    // that was a real paid call. Best effort on purpose, a failed refund must
    // not replace the real error.
    await db.user
      .updateMany({
        where: { id: userId, extractionCount: { gt: 0 } },
        data: { extractionCount: { decrement: 1 } },
      })
      .catch(() => {});

    return NextResponse.json(
      { error: 'Could not read this syllabus right now. Try again in a moment.' },
      { status: 500 },
    );
  }
}
