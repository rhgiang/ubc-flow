import type { SectionHit } from '@/lib/search';

/**
 * Where one saved section meets, as stored on ScheduleSection.
 *
 * The catalogue carries no room anywhere (UBC's course API exposes none), so
 * the only source is the student's own Workday export, layered onto the
 * matched section by upload/match-schedule. Saving used to keep section ids
 * alone, which threw that away: the rooms showed until you pressed Save and
 * were gone when the page came back.
 */
export type SectionLocation = {
  sectionId: string;
  building: string | null;
  room: string | null;
};

/**
 * A building code is a handful of letters and a room a handful of characters;
 * this only has to stop a hand-crafted request from parking an essay in the
 * column, since the value arrives from the client.
 */
const MAX_LENGTH = 40;

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_LENGTH);
}

/**
 * The location to save for each section the builder is holding.
 *
 * One per section, not one per meeting: an export lists a section once per
 * meeting block and match-schedule already keeps only the first, so a section
 * has a single place as far as anything here has ever known. Sections with no
 * location at all are left out rather than stored as a pair of nulls.
 */
export function collectSectionLocations(hits: SectionHit[]): SectionLocation[] {
  const found: SectionLocation[] = [];
  for (const hit of hits) {
    const meeting = hit.meetingTimes.find((m) => clean(m.building) || clean(m.room));
    if (!meeting) continue;
    found.push({
      sectionId: hit.sectionId,
      building: clean(meeting.building),
      room: clean(meeting.room),
    });
  }
  return found;
}

/** Server-side pass over whatever the client sent, keeping only real sections. */
export function sanitizeSectionLocations(
  locations: SectionLocation[] | undefined,
  allowedSectionIds: string[],
): SectionLocation[] {
  if (!locations?.length) return [];
  const allowed = new Set(allowedSectionIds);
  const seen = new Set<string>();
  const kept: SectionLocation[] = [];
  for (const loc of locations) {
    if (typeof loc?.sectionId !== 'string') continue;
    if (!allowed.has(loc.sectionId) || seen.has(loc.sectionId)) continue;
    const building = clean(loc.building);
    const room = clean(loc.room);
    if (!building && !room) continue;
    seen.add(loc.sectionId);
    kept.push({ sectionId: loc.sectionId, building, room });
  }
  return kept;
}

/**
 * Puts saved locations back on sections read from the catalogue.
 *
 * Fills only what the catalogue left empty, the same rule the import follows,
 * so if UBC ever does publish rooms the catalogue wins. Applies to every
 * meeting of the section: one section, one place.
 */
export function applySectionLocations(
  hits: SectionHit[],
  stored: SectionLocation[],
): SectionHit[] {
  if (stored.length === 0) return hits;
  const byId = new Map(stored.map((s) => [s.sectionId, s]));
  return hits.map((hit) => {
    const found = byId.get(hit.sectionId);
    if (!found) return hit;
    return {
      ...hit,
      meetingTimes: hit.meetingTimes.map((m) =>
        m.building || m.room
          ? m
          : { ...m, building: found.building, room: found.room },
      ),
    };
  });
}
