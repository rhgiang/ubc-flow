import type { CalendarEntry } from '@/components/schedule/ScheduleCalendar';
import { findBuilding, type Building } from '@/map/buildings';

/**
 * One place you stand during the day. Consecutive classes in the same
 * building merge into a single stop — walking from HENN to HENN is not a leg.
 */
export type RouteStop = {
  code: string;
  building: Building;
  /** One per class held here, in time order; label is "CPSC 110 · 09:00–10:00". */
  classes: { label: string; entry: CalendarEntry }[];
  /** Minutes since midnight; start of the first class, end of the last. */
  start: number;
  end: number;
};

export type RouteLeg = {
  /** Minutes between leaving one class and the next one starting. */
  gapMin: number;
  /** Estimated walk, minutes. */
  walkMin: number;
  /** The walk does not fit the gap. */
  tight: boolean;
};

/** "14:30" -> 870. */
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Great-circle distance in metres. */
export function metresBetween(a: Building, b: Building): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ponytail: straight-line × detour factor at walking pace, not street routing.
// The free routing servers are demo-grade (1 req/s, revocable); campus blocks
// are grid-ish, so 1.3 is the usual detour multiplier and 80 m/min is an
// ordinary walking speed. The estimate is labelled "~" in the UI and the pin
// popups already hand off to Google/Apple Maps for a real route. If this ever
// needs to be exact, the upgrade path is a self-hosted OSRM foot profile.
const DETOUR = 1.3;
const METRES_PER_MIN = 80;

export function walkMinutes(a: Building, b: Building): number {
  return Math.ceil((metresBetween(a, b) * DETOUR) / METRES_PER_MIN);
}

/**
 * A day's classes as an ordered walk: numbered stops and the legs between
 * them, each leg carrying the schedule gap and the walk estimate so a leg
 * that cannot be walked in time can be flagged.
 *
 * Entries without a start time or a locatable building can't be placed on a
 * route; their labels come back in `skipped` so the map can say so instead of
 * silently pretending the day is shorter than it is.
 */
export function dayRoute(
  entries: CalendarEntry[],
  day: string,
): { stops: RouteStop[]; legs: RouteLeg[]; skipped: string[] } {
  const stops: RouteStop[] = [];
  const skipped: string[] = [];

  const timed = entries
    .filter((e) => e.day === day)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  for (const e of timed) {
    const building = e.startTime && e.endTime ? findBuilding(e.building) : null;
    if (!building) {
      skipped.push(e.courseCode ?? e.label);
      continue;
    }
    const code = e.building!.toUpperCase();
    const label = `${e.courseCode ?? e.label} · ${e.startTime}–${e.endTime}`;
    const start = toMin(e.startTime!);
    const end = toMin(e.endTime!);
    const last = stops[stops.length - 1];
    if (last && last.code === code) {
      last.classes.push({ label, entry: e });
      last.end = Math.max(last.end, end);
    } else {
      stops.push({ code, building, classes: [{ label, entry: e }], start, end });
    }
  }

  const legs: RouteLeg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const gapMin = stops[i].start - stops[i - 1].end;
    const walkMin = walkMinutes(stops[i - 1].building, stops[i].building);
    legs.push({ gapMin, walkMin, tight: walkMin > gapMin });
  }

  return { stops, legs, skipped };
}
