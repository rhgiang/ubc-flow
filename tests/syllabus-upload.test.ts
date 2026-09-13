import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { validateSyllabusFile, MAX_SYLLABUS_BYTES } from '@/syllabus/validate';

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
    await db.$disconnect();
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
