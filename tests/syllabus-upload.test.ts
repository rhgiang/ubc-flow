import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import {
  validateSyllabusFile,
  validateSyllabusUrl,
  validateSyllabusText,
  MAX_SYLLABUS_BYTES,
  MAX_SYLLABUS_TEXT_CHARS,
  MAX_SYLLABUS_URL_CHARS,
} from '@/syllabus/validate';

describe('validateSyllabusFile', () => {
  it('accepts a normal PDF', () => {
    expect(validateSyllabusFile({ type: 'application/pdf', size: 900_000, name: 'cpsc221.pdf' }))
      .toBeNull();
  });

  it('rejects a non-PDF regardless of extension', () => {
    expect(validateSyllabusFile({ type: 'application/zip', size: 1000, name: 'syllabus.pdf' }))
      .toMatch(/PDF/);
  });

  it('rejects an oversized file before anything is uploaded', () => {
    expect(validateSyllabusFile({
      type: 'application/pdf', size: MAX_SYLLABUS_BYTES + 1, name: 'big.pdf',
    })).toMatch(/too large/i);
  });

  it('caps at 4MB, not 10MB - a Vercel Function request body over ~4.5MB never reaches this code', () => {
    expect(MAX_SYLLABUS_BYTES).toBe(4 * 1024 * 1024);
  });

  it('rejects an empty file', () => {
    expect(validateSyllabusFile({ type: 'application/pdf', size: 0, name: 'e.pdf' }))
      .toMatch(/empty/i);
  });
});

describe('validateSyllabusUrl', () => {
  it('accepts the http and https links a student would actually paste', () => {
    expect(validateSyllabusUrl('https://canvas.ubc.ca/courses/1234/assignments/syllabus'))
      .toBeNull();
    expect(validateSyllabusUrl('http://www.students.ubc.ca/x?y=1&z=2#frag')).toBeNull();
  });

  // The whole reason this parses rather than prefix-matches: the value ends
  // up in an href, so a scheme that executes must never survive.
  it.each([
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'blob:https://canvas.ubc.ca/abc',
    'ftp://example.com/syllabus.pdf',
  ])('rejects %s', (bad) => {
    expect(validateSyllabusUrl(bad)).toMatch(/http/i);
  });

  it('rejects something that is not a link at all', () => {
    expect(validateSyllabusUrl('canvas.ubc.ca/courses/1')).toMatch(/link/i);
  });

  it('rejects empty and whitespace-only', () => {
    expect(validateSyllabusUrl('')).not.toBeNull();
    expect(validateSyllabusUrl('   \n ')).not.toBeNull();
  });

  it('caps the length, so nobody parks a document in the column', () => {
    expect(validateSyllabusUrl(`https://x.ca/${'a'.repeat(MAX_SYLLABUS_URL_CHARS)}`))
      .toMatch(/too long/i);
  });
});

describe('validateSyllabusText', () => {
  it('accepts a pasted syllabus', () => {
    expect(validateSyllabusText('CPSC 221\nMidterm 1: Oct 14, 20%')).toBeNull();
  });

  it('rejects empty and whitespace-only', () => {
    expect(validateSyllabusText('')).not.toBeNull();
    expect(validateSyllabusText('  \t\n  ')).not.toBeNull();
  });

  // Straight into a paid model as input tokens: uncapped is an unbounded bill.
  it('rejects a paste over the cap, before anything could be sent', () => {
    expect(validateSyllabusText('x'.repeat(MAX_SYLLABUS_TEXT_CHARS + 1))).toMatch(/too long/i);
    expect(validateSyllabusText('x'.repeat(MAX_SYLLABUS_TEXT_CHARS))).toBeNull();
  });

  it('caps well above a real syllabus and well below a runaway paste', () => {
    expect(MAX_SYLLABUS_TEXT_CHARS).toBe(100_000);
  });
});

// Exercises the actual GET handler (not a re-implementation of the check it
// runs) with auth() mocked, so the test would fail if the ownership guard in
// src/app/api/syllabus/[id]/file/route.ts were ever removed. @vercel/blob's
// get() is mocked too - there is no real Blob store on this machine, and the
// point here is the ownership gate, not exercising the network call.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@vercel/blob', () => ({
  get: vi.fn(async () => ({
    statusCode: 200 as const,
    // Closed immediately: the extract route reads it to completion, and a
    // never-closing stream would hang that test rather than fail it.
    stream: new ReadableStream({ start(c) { c.close(); } }),
    headers: new Headers(),
    blob: {
      url: 'https://example.invalid/blob',
      downloadUrl: 'https://example.invalid/blob',
      pathname: 'syllabi/test-owner-cpsc221.pdf',
      contentDisposition: 'inline',
      cacheControl: 'private',
      uploadedAt: new Date(),
      etag: 'etag',
      contentType: 'application/pdf',
      size: 12_345,
    },
  })),
}));

// The extract route's owner path would otherwise reach the real Anthropic
// call. No test in this suite calls that API (spec S10), and the subject here
// is the ownership gate, not the extraction.
vi.mock('@/syllabus/extract', () => ({ extractAssessments: vi.fn(async () => []) }));

const { auth } = await import('@/lib/auth');
const { GET } = await import('@/app/api/syllabus/[id]/file/route');
const { POST: EXTRACT } = await import('@/app/api/syllabus/extract/route');
const { POST: SAVE_ASSESSMENTS } = await import('@/app/api/syllabus/[id]/assessments/route');
const { extractAssessments } = await import('@/syllabus/extract');

// `auth` is overloaded (it also doubles as Next middleware), which makes
// `vi.mocked(auth)` resolve to the wrong overload for mockResolvedValue.
// Cast once, here, to the one shape this route actually calls it as.
type AuthFn = () => Promise<{ user: { id: string } } | null>;
const mockedAuth = auth as unknown as ReturnType<typeof vi.fn<AuthFn>>;

describe('the syllabus file route ownership guard', () => {
  const OWNER = 'zz-syllabus-owner@example.com';
  const OTHER = 'zz-syllabus-other@example.com';
  let ownerId: string;
  let otherId: string;
  let syllabusId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } });
    ownerId = (await db.user.create({ data: { email: OWNER } })).id;
    otherId = (await db.user.create({ data: { email: OTHER } })).id;

    const course = await db.course.findFirstOrThrow({ select: { id: true } });
    const term = await db.term.findFirstOrThrow({ select: { id: true } });

    const syllabus = await db.syllabus.create({
      data: {
        userId: ownerId,
        courseId: course.id,
        termId: term.id,
        pathname: 'syllabi/test-owner-cpsc221.pdf',
        filename: 'cpsc221.pdf',
        size: 12_345,
      },
    });
    syllabusId = syllabus.id;
  });

  afterAll(async () => {
    await db.syllabus.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
    await db.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } });
  });

  function request() {
    return new Request(`http://localhost/api/syllabus/${syllabusId}/file`);
  }
  function params() {
    return Promise.resolve({ id: syllabusId });
  }

  it('401s when signed out', async () => {
    mockedAuth.mockResolvedValue(null);
    const res = await GET(request(), { params: params() });
    expect(res.status).toBe(401);
  });

  it('404s for a signed-in user who is not the owner - never 403, never confirms the id is real', async () => {
    mockedAuth.mockResolvedValue({ user: { id: otherId } });
    const res = await GET(request(), { params: params() });
    expect(res.status).toBe(404);
  });

  it('streams the file through for its owner', async () => {
    mockedAuth.mockResolvedValue({ user: { id: ownerId } });
    const res = await GET(request(), { params: params() });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });
});

// /file has this gate covered above; extract and assessments run the same
// findUnique-then-compare-userId check and had no test of their own, so a
// regression in either would have shipped silently. Same three cases, and the
// same 404-not-403 rule: never confirm another student's syllabus id is real.
describe('the other syllabus routes enforce the same ownership guard', () => {
  const OWNER = 'zz-syllabus-owner2@example.com';
  const OTHER = 'zz-syllabus-other2@example.com';
  let ownerId: string;
  let otherId: string;
  let syllabusId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } });
    ownerId = (await db.user.create({ data: { email: OWNER } })).id;
    otherId = (await db.user.create({ data: { email: OTHER } })).id;

    const course = await db.course.findFirstOrThrow({ select: { id: true } });
    const term = await db.term.findFirstOrThrow({ select: { id: true } });
    syllabusId = (await db.syllabus.create({
      data: {
        userId: ownerId,
        courseId: course.id,
        termId: term.id,
        pathname: 'syllabi/test-owner2-cpsc221.pdf',
        filename: 'cpsc221.pdf',
        size: 12_345,
      },
    })).id;
  });

  afterAll(async () => {
    await db.syllabus.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
    await db.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } });
  });

  function extractRequest() {
    return new Request('http://localhost/api/syllabus/extract', {
      method: 'POST',
      body: JSON.stringify({ syllabusId }),
    });
  }
  function saveRequest() {
    return new Request(`http://localhost/api/syllabus/${syllabusId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({ assessments: [] }),
    });
  }
  function params() {
    return Promise.resolve({ id: syllabusId });
  }

  it('extract 401s when signed out', async () => {
    mockedAuth.mockResolvedValue(null);
    expect((await EXTRACT(extractRequest())).status).toBe(401);
  });

  it('extract 404s for a signed-in non-owner, never 403', async () => {
    mockedAuth.mockResolvedValue({ user: { id: otherId } });
    expect((await EXTRACT(extractRequest())).status).toBe(404);
  });

  it('extract lets the owner through', async () => {
    mockedAuth.mockResolvedValue({ user: { id: ownerId } });
    expect((await EXTRACT(extractRequest())).status).toBe(200);
  });

  it('assessments 401s when signed out', async () => {
    mockedAuth.mockResolvedValue(null);
    expect((await SAVE_ASSESSMENTS(saveRequest(), { params: params() })).status).toBe(401);
  });

  it('assessments 404s for a signed-in non-owner, never 403', async () => {
    mockedAuth.mockResolvedValue({ user: { id: otherId } });
    expect((await SAVE_ASSESSMENTS(saveRequest(), { params: params() })).status).toBe(404);
  });

  it('assessments lets the owner through', async () => {
    mockedAuth.mockResolvedValue({ user: { id: ownerId } });
    const res = await SAVE_ASSESSMENTS(saveRequest(), { params: params() });
    expect(res.status).toBe(200);
  });

  // Unbounded authenticated input into createMany.
  it('caps how many assessment rows one save can insert', async () => {
    mockedAuth.mockResolvedValue({ user: { id: ownerId } });
    const row = { title: 'Midterm', kind: 'midterm', date: '2026-10-14', startTime: '18:00',
      weight: 10, quote: 'q', page: 1 };
    const req = new Request(`http://localhost/api/syllabus/${syllabusId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({ assessments: Array.from({ length: 250 }, () => row) }),
    });
    const res = await SAVE_ASSESSMENTS(req, { params: params() });
    expect(await res.json()).toMatchObject({ count: 100 });
  });
});

// A syllabus can be a PDF, a link, or pasted text, and only two of those can
// be read. The link case is the one that matters: we never fetch it, so it
// must be refused out loud rather than returning an empty assessment list,
// which is indistinguishable from a syllabus with no exams in it.
describe('which syllabus sources the extract route can read', () => {
  const OWNER = 'zz-syllabus-sources@example.com';
  let ownerId: string;
  let courseIds: string[];
  let termId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: OWNER } });
    ownerId = (await db.user.create({ data: { email: OWNER } })).id;
    const courses = await db.course.findMany({ take: 3, select: { id: true } });
    courseIds = courses.map((c) => c.id);
    termId = (await db.term.findFirstOrThrow({ select: { id: true } })).id;
  });

  afterAll(async () => {
    await db.syllabus.deleteMany({ where: { userId: ownerId } });
    await db.user.deleteMany({ where: { email: OWNER } });
    await db.$disconnect();
  });

  async function extract(data: {
    pathname?: string; filename?: string; size?: number; url?: string; sourceText?: string;
  }, courseIndex: number) {
    const { id } = await db.syllabus.upsert({
      where: {
        userId_courseId_termId: { userId: ownerId, courseId: courseIds[courseIndex], termId },
      },
      create: { userId: ownerId, courseId: courseIds[courseIndex], termId, ...data },
      update: data,
    });
    mockedAuth.mockResolvedValue({ user: { id: ownerId } });
    return EXTRACT(new Request('http://localhost/api/syllabus/extract', {
      method: 'POST',
      body: JSON.stringify({ syllabusId: id }),
    }));
  }

  it('refuses a link-only syllabus and names the paste box as the fix', async () => {
    const res = await extract({ url: 'https://canvas.ubc.ca/courses/1' }, 0);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/paste/i);
  });

  it('reads a pasted syllabus, sending the text itself', async () => {
    const res = await extract({ sourceText: 'Midterm 1: Oct 14 (20%)' }, 1);
    expect(res.status).toBe(200);
    expect(extractAssessments).toHaveBeenLastCalledWith('Midterm 1: Oct 14 (20%)');
  });

  it('reads an uploaded PDF, sending bytes rather than text', async () => {
    const res = await extract(
      { pathname: 'syllabi/zz-sources.pdf', filename: 'zz.pdf', size: 10 },
      2,
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(extractAssessments).mock.lastCall?.[0]).toBeInstanceOf(Buffer);
  });
});
