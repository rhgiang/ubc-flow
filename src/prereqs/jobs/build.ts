import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { parseRequirements, extractAntireqCodes, type Requirement } from '@/prereqs/parse';

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
 * Unmatched codes keep courseId: null and still render - as plain text.
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

export type AntireqRef = { code: string; courseId: string | null };

export async function resolveAntireqCodes(codes: string[]): Promise<AntireqRef[]> {
  const refs: AntireqRef[] = [];
  for (const code of codes) {
    const parts = vancouverCode(code);
    if (!parts) {
      refs.push({ code, courseId: null });
      continue;
    }
    const course = await db.course.findFirst({
      where: { number: parts.number, campus: 'V', subject: { code: parts.subject } },
      select: { id: true },
    });
    refs.push({ code, courseId: course?.id ?? null });
  }
  return refs;
}

/** Every resolved courseId referenced anywhere in a tree, deduplicated -
 * the set of edges buildRequirementTrees writes to CoursePrereqEdge. */
function collectResolvedCourseIds(tree: Requirement | null): Set<string> {
  const ids = new Set<string>();
  function walk(node: Requirement | null) {
    if (!node) return;
    if (node.type === 'course') {
      if (node.courseId) ids.add(node.courseId);
      return;
    }
    if (node.type === 'note') return;
    node.items.forEach(walk);
  }
  walk(tree);
  return ids;
}

export async function buildRequirementTrees(): Promise<BuildResult> {
  const courses = await db.course.findMany({
    select: { id: true, prereqText: true, coreqText: true },
  });

  const unresolved = new Set<string>();
  let updated = 0;
  let resolved = 0;

  // Wholesale rebuild - matches how prereqTree/coreqTree are already
  // overwritten every run (Global Constraints).
  await db.coursePrereqEdge.deleteMany({});

  for (const course of courses) {
    const prereqTree = await resolveTree(parseRequirements(course.prereqText), unresolved);
    const coreqTree = await resolveTree(parseRequirements(course.coreqText), unresolved);
    const antireqRefs = await resolveAntireqCodes(extractAntireqCodes(course.prereqText));

    await db.course.update({
      where: { id: course.id },
      // Overwritten wholesale every run - no accumulation, trivially idempotent.
      // Prisma.DbNull, not undefined: undefined means "skip this field", which
      // would leave a stale tree behind if the text stopped parsing.
      data: {
        prereqTree: prereqTree ?? Prisma.DbNull,
        coreqTree: coreqTree ?? Prisma.DbNull,
        antireqCodes: antireqRefs.length ? antireqRefs : Prisma.DbNull,
      },
    });

    const requiredIds = collectResolvedCourseIds(prereqTree);
    if (requiredIds.size > 0) {
      await db.coursePrereqEdge.createMany({
        data: [...requiredIds].map((requiredCourseId) => ({
          courseId: course.id,
          requiredCourseId,
        })),
        skipDuplicates: true,
      });
    }

    resolved += countResolved(prereqTree) + countResolved(coreqTree);
    updated += 1;
  }

  console.log(
    `Built trees for ${updated} courses. ${resolved} course links resolved, ` +
      `${unresolved.size} distinct codes unresolved.`,
  );

  return { updated, resolved, unresolved: [...unresolved] };
}
