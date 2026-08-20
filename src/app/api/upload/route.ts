import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { readWorkbookGrid } from '@/upload/read-grid';
import { parseWorkdayExport } from '@/upload/parse-workday';
import { importExport } from '@/upload/import';

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  // Size is checked BEFORE parsing — a zip bomb must never reach the parser.
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large (max 2 MB).' }, { status: 413 });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Upload the .xlsx export from Workday.' }, { status: 400 });
  }

  try {
    // Held in memory only — never written to disk, never logged.
    const grid = await readWorkbookGrid(await file.arrayBuffer());
    const parsed = parseWorkdayExport(grid);

    if (!parsed.studentNumber) {
      return NextResponse.json(
        { error: "That file doesn't look like a Workday export — no student found." },
        { status: 400 },
      );
    }

    const result = await importExport(session.user.id, parsed);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not read that file.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
