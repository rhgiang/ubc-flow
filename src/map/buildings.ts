import raw from './ubcv-buildings.json';

/**
 * UBC Vancouver building locations, vendored once from UBC's open geospatial
 * dataset (github.com/UBCGeodata/ubc-geospatial-opendata,
 * ubcv/locations/csv/ubcv_buildings_simple.csv). Keyed by the official
 * building code - the same codes Workday writes into meeting patterns
 * (SWNG, ICCS, ESB...), verified against every imported meeting on record.
 */
export type Building = { name: string; lat: number; lng: number };

const BUILDINGS = raw as Record<string, Building>;

export function findBuilding(code: string | null | undefined): Building | null {
  if (!code) return null;
  return BUILDINGS[code.toUpperCase()] ?? null;
}

/**
 * "2207" -> "Floor 2", "121" -> "Floor 1", "B101" -> "Basement".
 *
 * ponytail: UBC room numbers put the floor in the leading digit (B for
 * basement) - right for nearly every building on campus, but a heuristic,
 * not data. If an odd building misleads someone, the fix is a per-building
 * override table here, not more parsing.
 */
export function floorFromRoom(room: string | null | undefined): string | null {
  if (!room) return null;
  const m = room.trim().match(/^([A-Za-z]?)(\d+)/);
  if (!m) return null;
  if (m[1].toUpperCase() === 'B') return 'Basement';
  if (m[1]) return null; // other letter prefixes: no safe guess
  if (m[2].length < 3) return null; // "12": nothing encodes a floor
  return `Floor ${m[2][0]}`;
}
