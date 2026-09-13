import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  validateSyllabusFile,
  validateSyllabusUrl,
  validateSyllabusText,
  sanitizeFilename,
} from '@/syllabus/validate';

// The enrollment gate and the (userId, courseId, termId) upsert bound stored
// BYTES to one blob per enrolled course, but not billed write OPERATIONS:
// re-POSTing the same course, or DELETE-then-POST, loops put() forever. 10 a
// day is several times more than any honest student - you upload a syllabus
// once per course, and a handful more if you re-upload a corrected PDF -
// while capping what a compromised or scripted account can bill.
// Same fixed-window shape and same atomic conditional-updateMany as
// src/app/api/syllabus/extract/route.ts; see the long comment there for why
// it is two updateManys rather than a read-then-write.
const UPLOADS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const userId = session.user.id;

  const form = await req.formData();
  const courseId = form.get('courseId');
  const termId = form.get('termId');
  if (typeof courseId !== 'string' || typeof termId !== 'string' || !courseId || !termId) {
    return NextResponse.json({ error: 'Missing courseId or termId.' }, { status: 400 });
  }

  // Exactly one source per request, because each one is a separate action in
  // the UI. The three are not mutually exclusive on the ROW: a link posted
  // for a course that already has a PDF adds the link and leaves the file
  // alone, which is why the update below only ever touches its own fields.
  const rawFile = form.get('file');
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;
  const rawUrl = form.get('url');
  const url = typeof rawUrl === 'string' && rawUrl.trim() !== '' ? rawUrl.trim() : null;
  const rawText = form.get('sourceText');
  const sourceText = typeof rawText === 'string' && rawText.trim() !== '' ? rawText.trim() : null;

  // A row with none of the three would be an empty syllabus, which the model
  // in prisma/schema.prisma says cannot exist. Postgres cannot express that
  // as a constraint through Prisma, so this route (the only writer) is where
  // it is enforced.
  if (!file && !url && !sourceText) {
    return NextResponse.json(
      { error: 'Add a PDF, a link, or the syllabus text.' },
      { status: 400 },
    );
  }

  // Validated BEFORE any write - a rejected file must never reach put(), and
  // a rejected url or paste must never reach the database. Empty and
  // whitespace-only values were already dropped to null above.
  const validationError = (file && validateSyllabusFile(file))
    || (url && validateSyllabusUrl(url))
    || (sourceText && validateSyllabusText(sourceText));
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // The only bound on how much billed blob storage one account can create:
  // courseId/termId are otherwise caller-supplied, so without this a signed-in
  // user could mint unlimited private blobs against courses they've never
  // taken. A syllabus for a course you're not enrolled in is meaningless
  // anyway. Same query shape as src/app/syllabus/page.tsx's enrollment lookup.
  const enrollment = await db.enrollment.findFirst({
    where: { userId, courseId, termId },
    select: { id: true },
  });
  if (!enrollment) {
    return NextResponse.json({ error: "You're not enrolled in that course this term." }, { status: 403 });
  }

  // A link or a paste writes one row and no blob. The upload cap exists to
  // bound billed put() calls, and the enrollment gate plus the
  // (userId, courseId, termId) unique key already bound these to one row per
  // enrolled course, with the two columns length-capped above. So the quota
  // stays on the thing that costs money: file uploads only.
  if (!file) {
    const syllabus = await db.syllabus.upsert({
      where: { userId_courseId_termId: { userId, courseId, termId } },
      create: { userId, courseId, termId, url, sourceText },
      // Only the field this request carried: adding a link must not wipe a
      // paste, and vice versa.
      update: { ...(url ? { url } : {}), ...(sourceText ? { sourceText } : {}) },
    });
    return NextResponse.json({
      id: syllabus.id,
      url: syllabus.url,
      hasText: syllabus.sourceText !== null,
    });
  }

  // Charged here: after the file and the enrollment have both checked out (a
  // rejected request shouldn't cost a quota unit), before the billed put().
  const now = new Date();
  const windowCutoff = new Date(now.getTime() - DAY_MS);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { uploadWindowStart: true },
  });
  const windowExpired = !user?.uploadWindowStart || user.uploadWindowStart < windowCutoff;
  const capUpdate = windowExpired
    ? await db.user.updateMany({
        where: {
          id: userId,
          OR: [{ uploadWindowStart: null }, { uploadWindowStart: { lt: windowCutoff } }],
        },
        data: { uploadCount: 1, uploadWindowStart: now },
      })
    : await db.user.updateMany({
        where: { id: userId, uploadCount: { lt: UPLOADS_PER_DAY } },
        data: { uploadCount: { increment: 1 } },
      });
  if (capUpdate.count === 0) {
    return NextResponse.json(
      { error: `You've hit today's limit of ${UPLOADS_PER_DAY} syllabus uploads. Try again tomorrow.` },
      { status: 429 },
    );
  }

  const safeName = sanitizeFilename(file.name);

  // Kept so a re-upload's old blob is cleaned up below rather than left
  // dangling in the private store forever.
  const existing = await db.syllabus.findUnique({
    where: { userId_courseId_termId: { userId, courseId, termId } },
    select: { pathname: true },
  });

  try {
    const blob = await put(`syllabi/${userId}/${courseId}-${termId}-${safeName}`, file, {
      access: 'private',
      addRandomSuffix: true,
      contentType: 'application/pdf',
    });

    const syllabus = await db.syllabus.upsert({
      where: { userId_courseId_termId: { userId, courseId, termId } },
      create: { userId, courseId, termId, pathname: blob.pathname, filename: safeName, size: file.size },
      update: { pathname: blob.pathname, filename: safeName, size: file.size },
    });

    if (existing?.pathname && existing.pathname !== blob.pathname) {
      // Best-effort: the upload already succeeded and is recorded, so a
      // failure to clean up the superseded blob is a leaked file, not a
      // reason to fail the request the student is waiting on.
      await del(existing.pathname).catch(() => {});
    }

    return NextResponse.json({ id: syllabus.id, filename: syllabus.filename, size: syllabus.size });
  } catch (e) {
    // The message only, never the file, the URL, the pasted text or who sent
    // it: the same rule src/app/api/upload/route.ts follows. Without this the
    // student sees "try again in a moment" and the server keeps no record of
    // why, which is how a missing BLOB_READ_WRITE_TOKEN looks exactly like a
    // transient failure.
    console.error('syllabus save failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not upload that file. Try again in a moment.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  }

  // Scoped to the signed-in user - never someone else's row, and a
  // non-existent/foreign id gets the same 404 as a missing one.
  const syllabus = await db.syllabus.findFirst({ where: { id, userId: session.user.id } });
  if (!syllabus) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // A student who deletes a syllabus has asked for the file to be gone -
  // both the blob and the row go, not just the row. If the blob delete
  // fails, the row is left in place rather than silently orphaning a
  // private file the UI would then claim doesn't exist. A link-only or
  // text-only row has no blob to remove, so it skips straight to the row.
  if (syllabus.pathname) {
    try {
      await del(syllabus.pathname);
    } catch {
      return NextResponse.json({ error: 'Could not delete that file. Try again in a moment.' }, { status: 500 });
    }
  }
  await db.syllabus.delete({ where: { id: syllabus.id } });

  return NextResponse.json({ ok: true });
}
