import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { parseRequirements, type Requirement } from '@/prereqs/parse';

export type BuildResult = {
  updated: number;
  resolved: number;
  unresolved: string[];
};

/** "ECON 101" -> { subject: 'ECON', number: '101' }; "MGMT_O 301" -> null. */
function vancouverCode(code: string): { subject: string; number: string } | null {
  // An _O code is Okanagan. Resolving it against campus 'V' would attach a
  // different course entirely, so it deliberately never resolves.
  const m = code.match(/^([A-Z]{2,5})\s(\d{2,3}[A-Z]?)$/);
  return m ? { subject: m[1], number: m[2] } : null;
}

/**
 * Walks a parsed tree and fills in courseId for every code we can match.
 * Unmatched codes keep courseId: null and still render — as plain text.
 */
export async function resolveTree(
  tree: Requirement | null,
  unresolved?: Set<string>,
): Promise<Requirement | null> {
  if (!tree) return null;

  if (tree.type === 'note') return tree;

  if (tree.type === 'course') {
    const parts = vancouverCode(tree.code);
    if (!parts) {
      unresolved?.add(tree.code);
      return tree;
    }
    const course = await db.course.findFirst({
      where: {
        number: parts.number,
        campus: 'V',
        subject: { code: parts.subject },
      },
      select: { id: true },
    });
    if (!course) unresolved?.add(tree.code);
    return { ...tree, courseId: course?.id ?? null };
  }

  const items: Requirement[] = [];
  for (const item of tree.items) {
    const resolved = await resolveTree(item, unresolved);
    if (resolved) items.push(resolved);
  }
  return { ...tree, items };
}

function countResolved(tree: Requirement | null): number {
  if (!tree) return 0;
  if (tree.type === 'course') return tree.courseId ? 1 : 0;
  if (tree.type === 'note') return 0;
  return tree.items.reduce((n, i) => n + countResolved(i), 0);
}

export async function buildRequirementTrees(): Promise<BuildResult> {
  const courses = await db.course.findMany({
    select: { id: true, prereqText: true, coreqText: true },
  });

  const unresolved = new Set<string>();
  let updated = 0;
  let resolved = 0;

  for (const course of courses) {
    const prereqTree = await resolveTree(parseRequirements(course.prereqText), unresolved);
    const coreqTree = await resolveTree(parseRequirements(course.coreqText), unresolved);

    await db.course.update({
      where: { id: course.id },
      // Overwritten wholesale every run — no accumulation, trivially idempotent.
      // Prisma.DbNull, not undefined: undefined means "skip this field", which
      // would leave a stale tree behind if the text stopped parsing.
      data: {
        prereqTree: prereqTree ?? Prisma.DbNull,
        coreqTree: coreqTree ?? Prisma.DbNull,
      },
    });

    resolved += countResolved(prereqTree) + countResolved(coreqTree);
    updated += 1;
  }

  console.log(
    `Built trees for ${updated} courses. ${resolved} course links resolved, ` +
      `${unresolved.size} distinct codes unresolved.`,
  );

  return { updated, resolved, unresolved: [...unresolved] };
}
