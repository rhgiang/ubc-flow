export type Requirement =
  | { type: 'course'; code: string; courseId: string | null }
  | { type: 'and'; items: Requirement[] }
  | { type: 'or'; items: Requirement[] }
  | { type: 'note'; text: string };

/** SUBJ[_CAMPUS] NNN[letter] — e.g. CPSC 221, CHEM_V 121, MATH_O 200, FNEL 201A. */
const COURSE_CODE = /\b[A-Z]{2,5}(?:_[A-Z])?\s?\d{2,3}[A-Z]?\b/g;

/**
 * Eligibility language. A clause containing any of this is NOT a course
 * dependency — it is standing, permission, a grade floor, or a program
 * restriction. Parse nothing from it; keep the sentence verbatim.
 */
const BAILOUT =
  /\b(standing|permission|restrict\w*|credits?|average|score|instructor|majors?|programs?|enrol\w*|department|faculty|recommend\w*)\b/i;

/**
 * Grouping we do not positively handle: lettered alternatives, "either", a
 * standalone "or", and a quantified "N of" (e.g. "two of", "3 of") where N is
 * not "one" — we have no way to express "any N of these" as a tree, so it must
 * not fall through to the bare-list AND default. Checked BEFORE the One
 * of/All of rules, because real rows like KIN 211 open with "All of" and then
 * use (a)/(b) alternatives — reading that as a flat AND would tell a student
 * to take every listed course. This same check also stops the OR-collapse
 * heuristic below from firing on a "two of ..." segment (real row: ELEC 391),
 * since the whole clause now bails before that logic ever runs.
 */
const AMBIGUOUS =
  /\([a-z]\)|\beither\b|\bany\b|\bor\b|\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+of\b/i;

function stripEquivalency(text: string): string {
  // "Equivalency: CHEM_V 141" is a credit exclusion, not a requirement.
  return text.replace(/\bEquivalenc(?:y|ies)\s*:[^.]*\.?/gi, ' ');
}

/**
 * The codes inside an "Equivalency:" clause — captured, not discarded, the
 * way stripEquivalency (used by parseRequirements) throws them away. These
 * are credit exclusions, not prerequisites, so they never enter a
 * Requirement tree — they're a separate flat list (spec §4.1).
 */
export function extractAntireqCodes(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/\bEquivalenc(?:y|ies)\s*:[^.]*\.?/gi);
  if (!matches) return [];
  return matches.flatMap((clause) => extractCodes(clause)).map((c) => {
    const node = toCourseNode(c);
    return node.type === 'course' ? node.code : c;
  });
}

function toCourseNode(raw: string): Requirement {
  const m = raw.match(/^([A-Z]{2,5})(?:_([A-Z]))?\s?(\d{2,3}[A-Z]?)$/);
  if (!m) return { type: 'course', code: raw, courseId: null };
  const [, subject, campus, number] = m;
  // Vancouver is this app's default and its suffix is noise; Okanagan must stay
  // visible, since it is a different campus and never resolves to a link.
  const code = campus === 'O' ? `${subject}_O ${number}` : `${subject} ${number}`;
  return { type: 'course', code, courseId: null };
}

function extractCodes(text: string): string[] {
  return [...text.matchAll(COURSE_CODE)].map((m) => m[0]);
}

/** Collapse a group into its single child, and merge same-type nesting. */
function flatten(node: Requirement): Requirement {
  if (node.type !== 'and' && node.type !== 'or') return node;
  const items: Requirement[] = [];
  for (const item of node.items) {
    const f = flatten(item);
    if (f.type === node.type) items.push(...f.items);
    else items.push(f);
  }
  return items.length === 1 ? items[0] : { ...node, items };
}

/** One segment: "one of A, B" -> OR; "A, B" -> AND; "A" -> the course itself. */
function parseGroup(segment: string): Requirement | null {
  const text = segment.trim().replace(/^[,;\s]+|[,;.\s]+$/g, '');
  if (!text) return null;

  const codes = extractCodes(text);
  if (codes.length === 0) return null;

  const nodes = codes.map(toCourseNode);
  if (nodes.length === 1) return nodes[0];

  const isOr = /\bone of\b/i.test(text);
  return { type: isOr ? 'or' : 'and', items: nodes };
}

function parseClause(clause: string): Requirement | null {
  const text = clause.trim().replace(/[.\s]+$/, '');
  if (!text) return null;

  // Order matters — see AMBIGUOUS above.
  if (BAILOUT.test(text) || AMBIGUOUS.test(text)) return { type: 'note', text };
  if (extractCodes(text).length === 0) return { type: 'note', text };

  const segments = splitOnAnd(text);

  // Special case: "One of A, B, C and D" where D is bare (no "one of"/"all of")
  // is a 4-way OR, not "one of A,B,C PLUS mandatory D". Detect when the first
  // segment declares "one of" but a later segment is bare (declares neither).
  if (segments.length > 1) {
    const firstHasOneOf = /\bone of\b/i.test(segments[0]);
    const hasBareLater = segments.slice(1).some(
      (seg) => !/\b(?:one of|all of)\b/i.test(seg)
    );
    if (firstHasOneOf && hasBareLater) {
      const codes = extractCodes(text);
      return flatten({
        type: 'or',
        items: codes.map(toCourseNode),
      });
    }
  }

  const parsedSegments = segments.map(parseGroup);
  // If ANY and-segment fails to produce a node (e.g. a typo'd course code),
  // the whole clause bails to a note instead of silently proceeding with the
  // segments that did parse — a group that looks complete but is missing
  // content is worse than an unparsed sentence (real row: BEST 201).
  if (parsedSegments.some((g) => g === null)) return { type: 'note', text };
  const groups = parsedSegments as Requirement[];

  if (groups.length === 0) return { type: 'note', text };
  return flatten(groups.length === 1 ? groups[0] : { type: 'and', items: groups });
}

function splitOnAnd(text: string): string[] {
  return text.split(/\s+and\s+/i);
}

export function parseRequirements(text: string | null): Requirement | null {
  if (!text || !text.trim()) return null;

  const clauses = stripEquivalency(text)
    .split(/[.;]/)
    .map((c) => c.trim())
    .filter(Boolean);

  const items = clauses
    .map(parseClause)
    .filter((r): r is Requirement => r !== null);

  if (items.length === 0) return null;
  return flatten(items.length === 1 ? items[0] : { type: 'and', items });
}
