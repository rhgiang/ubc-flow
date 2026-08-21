import { describe, it, expect, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { resolveTree } from '@/prereqs/jobs/build';
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
    // course entirely — the code must display as text with no link.
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
