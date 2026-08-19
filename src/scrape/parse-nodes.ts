import { normalizeInstructorName } from '@/scrape/names';

export type JsonApiResource = {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data?: { type: string; id: string } | null }>;
};

export type SectionNode = JsonApiResource;
export type IncludedMap = Map<string, JsonApiResource>;

export type RawMeeting = {
  day: string;
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
};

export type RawCourse = {
  subjectCode: string;
  campus: string;
  number: string;
  title: string;
  credits: number | null;
  bodyHtml: string | null;
};

export type RawSection = {
  sectionCode: string;
  activity: string | null;
  status: string | null;
  deliveryMode: string | null;
  instructorNames: string[];
  meetings: RawMeeting[];
  course: RawCourse | null;
};

const DAY_MAP: Record<string, string> = {
  m: 'Mon',
  t: 'Tue',
  w: 'Wed',
  th: 'Thu',
  f: 'Fri',
  s: 'Sat',
  su: 'Sun',
};

/** "CPSC_V 221" -> subject CPSC, campus V, number 221 */
export function parseUbcCourseCode(
  raw: string,
): { subjectCode: string; campus: string; number: string } | null {
  const m = String(raw).trim().match(/^([A-Z]{2,6})_([VO])\s+(\d{3}[A-Z]?)$/);
  if (!m) return null;
  return { subjectCode: m[1], campus: m[2], number: m[3] };
}

/** Seconds since midnight -> "HH:MM". */
export function secondsToTime(s: number | null): string | null {
  if (s === null || s === undefined || !Number.isFinite(s)) return null;
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** ["m","w","f"] -> ["Mon","Wed","Fri"]; unknown codes are dropped. */
export function parseDays(days: string[] | null): string[] {
  if (!days) return [];
  return days.map((d) => DAY_MAP[String(d).toLowerCase()]).filter(Boolean);
}

export function buildIncludedMap(included: JsonApiResource[]): IncludedMap {
  return new Map(included.map((r) => [`${r.type}:${r.id}`, r]));
}

function related(
  node: JsonApiResource,
  field: string,
  included: IncludedMap,
): JsonApiResource | null {
  const ref = node.relationships?.[field]?.data;
  if (!ref) return null;
  return included.get(`${ref.type}:${ref.id}`) ?? null;
}

function termName(node: JsonApiResource, field: string, included: IncludedMap): string | null {
  const r = related(node, field, included);
  const name = r?.attributes?.name;
  return typeof name === 'string' ? name : null;
}

function parseCourseNode(node: JsonApiResource | null): RawCourse | null {
  if (!node) return null;
  const code = parseUbcCourseCode(String(node.attributes.field_course_code ?? ''));
  if (!code) return null;

  const rawCredits = node.attributes.field_credits;
  const credits = rawCredits === null || rawCredits === undefined ? null : Number(rawCredits);

  const body = node.attributes.body as { value?: string } | null | undefined;

  return {
    ...code,
    title: String(node.attributes.title ?? ''),
    credits: Number.isFinite(credits as number) ? (credits as number) : null,
    bodyHtml: body?.value ?? null,
  };
}

export function parseSectionNode(node: SectionNode, included: IncludedMap): RawSection {
  const a = node.attributes;

  const startTime = secondsToTime((a.field_start_time as number | null) ?? null);
  const endTime = secondsToTime((a.field_end_time as number | null) ?? null);

  const meetings = parseDays((a.field_days as string[] | null) ?? null).map((day) => ({
    day,
    startTime,
    endTime,
    // The API exposes no location anywhere — confirmed during the Task 3 spike.
    building: null,
    room: null,
  }));

  const instructorNames = ((a.field_instructors as string[] | null) ?? [])
    .map((n) => normalizeInstructorName(n).name)
    .filter(Boolean);

  return {
    sectionCode: String(a.field_section_number ?? ''),
    activity: termName(node, 'field_instructional_method', included),
    status: termName(node, 'field_status', included),
    deliveryMode: termName(node, 'field_delivery_mode', included),
    instructorNames,
    meetings,
    course: parseCourseNode(related(node, 'field_course', included)),
  };
}
