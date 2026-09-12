import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { validateSyllabusFile } from '@/syllabus/validate';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const userId = session.user.id;

  const form = await req.formData();
  const file = form.get('file');
  const courseId = form.get('courseId');
  const termId = form.get('termId');
  if (!(file instanceof File) || typeof courseId !== 'string' || typeof termId !== 'string' || !courseId || !termId) {
    return NextResponse.json({ error: 'Missing file, courseId, or termId.' }, { status: 400 });
  }

  // Validated BEFORE any blob write — a rejected file must never reach put().
  const validationError = validateSyllabusFile(file);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Kept so a re-upload's old blob is cleaned up below rather than left
  // dangling in the private store forever.
  const existing = await db.syllabus.findUnique({
    where: { userId_courseId_termId: { userId, courseId, termId } },
    select: { pathname: true },
  });

  try {
    const blob = await put(`syllabi/${userId}/${courseId}-${termId}-${file.name}`, file, {
      access: 'private',
      addRandomSuffix: true,
      contentType: 'application/pdf',
    });

    const syllabus = await db.syllabus.upsert({
      where: { userId_courseId_termId: { userId, courseId, termId } },
      create: { userId, courseId, termId, pathname: blob.pathname, filename: file.name, size: file.size },
      update: { pathname: blob.pathname, filename: file.name, size: file.size },
    });

    if (existing && existing.pathname !== blob.pathname) {
      // Best-effort: the upload already succeeded and is recorded, so a
      // failure to clean up the superseded blob is a leaked file, not a
      // reason to fail the request the student is waiting on.
      await del(existing.pathname).catch(() => {});
    }

    return NextResponse.json({ id: syllabus.id, filename: syllabus.filename, size: syllabus.size });
  } catch {
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

  // Scoped to the signed-in user — never someone else's row, and a
  // non-existent/foreign id gets the same 404 as a missing one.
  const syllabus = await db.syllabus.findFirst({ where: { id, userId: session.user.id } });
  if (!syllabus) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // A student who deletes a syllabus has asked for the file to be gone —
  // both the blob and the row go, not just the row. If the blob delete
  // fails, the row is left in place rather than silently orphaning a
  // private file the UI would then claim doesn't exist.
  try {
    await del(syllabus.pathname);
  } catch {
    return NextResponse.json({ error: 'Could not delete that file. Try again in a moment.' }, { status: 500 });
  }
  await db.syllabus.delete({ where: { id: syllabus.id } });

  return NextResponse.json({ ok: true });
}
