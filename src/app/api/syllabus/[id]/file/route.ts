import { get } from '@vercel/blob';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { sanitizeFilename } from '@/syllabus/validate';

// The blob store is private - there is no directly-fetchable URL for a
// syllabus. This route is the ONLY reader: it re-checks ownership on every
// request and streams the bytes through from get(), so <embed> in the
// browser never talks to Vercel Blob directly.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Not signed in.', { status: 401 });
  }

  const { id } = await params;
  const syllabus = await db.syllabus.findUnique({ where: { id } });

  // Same 404 whether the id doesn't exist or belongs to someone else - never
  // confirm to a caller that another student's syllabus id is real.
  if (!syllabus || syllabus.userId !== session.user.id) {
    return new Response('Not found.', { status: 404 });
  }

  let blob;
  try {
    blob = await get(syllabus.pathname, { access: 'private' });
  } catch {
    return new Response('Could not read that file.', { status: 500 });
  }
  if (!blob || blob.statusCode !== 200) {
    return new Response('Not found.', { status: 404 });
  }

  // Sanitized again here (not just on write): a row written before this
  // check existed could still carry an unsafe filename, and this header
  // value must never carry one through unescaped.
  const safeName = sanitizeFilename(syllabus.filename);

  return new Response(blob.stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
      // Never cached by a shared cache or disk - this is a private document.
      'Cache-Control': 'private, no-store',
    },
  });
}
