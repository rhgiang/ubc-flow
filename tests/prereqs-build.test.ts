import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { resolveTree, buildRequirementTrees, resolveAntireqCodes } from '@/prereqs/jobs/build';
import { parseRequirements } from '@/prereqs/parse';

afterAll(async () => {
  await db.$disconnect();
});

describe('resolveTree', () => {
  it('returns null for a null tree', async () => {
    expect(await resolveTree(null)).toBeNull();
  });

  it('resolves a real Vancouver course code to its id', async () => {
    const tree = await resolveTree(parseRequirements('ECON 101.'));
    expect(tree).not.toBeNull();
    expect(tree!.type).toBe('course');
    if (tree!.type === 'course') {
      expect(tree!.code).toBe('ECON 101');
      const course = await db.course.findUniqueOrThrow({
        where: { id: tree!.courseId! },
        include: { subject: true },
      });
      expect(course.subject.code).toBe('ECON');
      expect(course.number).toBe('101');
    }
  });

  it('leaves an Okanagan code unresolved but still present', async () => {
    // Stripping _O and resolving against Vancouver would attach a different
    // course entirely - the code must display as text with no link.
    const tree = await resolveTree(parseRequirements('One of ECON_V 101, MGMT_O 301.'));
    expect(tree!.type).toBe('or');
    if (tree!.type === 'or') {
      const okanagan = tree!.items.find(
        (i) => i.type === 'course' && i.code === 'MGMT_O 301',
      );
      expect(okanagan).toBeDefined();
      expect(okanagan!.type === 'course' && okanagan!.courseId).toBeNull();
    }
  });

  it('leaves a code that is not in our catalogue unresolved', async () => {
    const tree = await resolveTree(parseRequirements('ZZZZ 999.'));
    expect(tree!.type === 'course' && tree!.courseId).toBeNull();
  });

  it('resolves codes nested inside groups', async () => {
    const tree = await resolveTree(parseRequirements('All of ECON_V 101, ECON_V 102.'));
    expect(tree!.type).toBe('and');
    if (tree!.type === 'and') {
      for (const item of tree!.items) {
        expect(item.type === 'course' && item.courseId).toBeTruthy();
      }
    }
  });

  it('passes note leaves through untouched', async () => {
    const tree = await resolveTree(parseRequirements('Permission of instructor is required.'));
    expect(tree).toEqual({ type: 'note', text: 'Permission of instructor is required' });
  });
});

describe('buildRequirementTrees', () => {
  // buildRequirementTrees() has no way to scope itself to specific courses -
  // it always processes the entire catalogue (~7337 rows), so this single
  // real run is used to prove both the result shape (a) and the idempotency
  // regression (b), rather than paying the ~2-minute cost twice.
  let staleCourseId: string;
  let staleCourseOriginalTree: Prisma.JsonValue | null;

  beforeAll(async () => {
    // Pick a course that currently has no prereqText, then inject a fake
    // "stale" tree onto it - simulating a course whose text used to parse to
    // something but has since gone null. Before the fix this regression test
    // guards, buildRequirementTrees() filtered its query to courses with
    // non-null prereqText/coreqText, so a row like this would never be
    // visited and its stale tree would survive forever.
    const course = await db.course.findFirstOrThrow({
      where: { prereqText: null },
      select: { id: true, prereqTree: true },
    });
    staleCourseId = course.id;
    staleCourseOriginalTree = course.prereqTree;
    await db.course.update({
      where: { id: staleCourseId },
      data: { prereqTree: { type: 'note', text: 'STALE - must be cleared by the job' } },
    });
  });

  afterAll(async () => {
    // The job's own run below already rewrites this row correctly, but
    // restore the pre-test value explicitly so this test never depends on
    // ordering relative to whatever buildRequirementTrees leaves behind.
    await db.course.update({
      where: { id: staleCourseId },
      data: { prereqTree: staleCourseOriginalTree ?? Prisma.DbNull },
    });
  });

  it(
    'processes the whole catalogue and clears a stale tree for a course whose text is null',
    async () => {
      const result = await buildRequirementTrees();

      // (a) BuildResult shape/counts are sane - roughly the whole catalogue.
      expect(result.updated).toBeGreaterThan(7000);
      expect(result.resolved).toBeGreaterThan(0);
      expect(result.unresolved.length).toBeGreaterThanOrEqual(0);

      // (b) Regression: a course with null prereqText must have prereqTree
      // written back to null, not left stale. This is the idempotency fix
      // from an earlier fix-loop round (removing the WHERE prereqText IS NOT
      // NULL OR coreqText IS NOT NULL filter) - without it, this assertion
      // fails because the perturbed row above is never visited.
      const after = await db.course.findUniqueOrThrow({
        where: { id: staleCourseId },
        select: { prereqTree: true },
      });
      expect(after.prereqTree).toBeNull();
    },
    180_000,
  );
});

describe('resolveAntireqCodes', () => {
  it('resolves a real Vancouver course code', async () => {
    const [ref] = await resolveAntireqCodes(['ECON 101']);
    expect(ref.code).toBe('ECON 101');
    expect(ref.courseId).not.toBeNull();
  });

  it('leaves an Okanagan code unresolved but present', async () => {
    const [ref] = await resolveAntireqCodes(['MGMT_O 301']);
    expect(ref.code).toBe('MGMT_O 301');
    expect(ref.courseId).toBeNull();
  });

  it('returns an empty array for an empty input', async () => {
    expect(await resolveAntireqCodes([])).toEqual([]);
  });
});
