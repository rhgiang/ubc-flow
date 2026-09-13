export function parseCourseCode(code: string): { subjectCode: string; number: string } | null {
  const m = code.match(/^([a-z]{2,5})-(\d{3}[a-z]?)$/i);
  if (!m) return null;
  return { subjectCode: m[1].toUpperCase(), number: m[2].toUpperCase() };
}

export function formatMeeting(m: {
  day: string;
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
}): string {
  const time = m.startTime && m.endTime ? ` ${m.startTime}-${m.endTime}` : '';
  const place = m.building ? ` · ${m.building}${m.room ? ` ${m.room}` : ''}` : '';
  return `${m.day}${time}${place}`;
}

/**
 * Where a meeting happens, in as much detail as the export gave us.
 *
 * The floor has been parsed out of the Workday meeting pattern since day one
 * and thrown away; "CIRS 1250" is easier to find as "CIRS 1250 · Floor 2".
 * Omitted when the room number already encodes it, which is common.
 */
/**
 * UBC Learning Spaces' official page for a room - photos, floor, layout,
 * capacity: learningspaces.ubc.ca/classrooms/swng-121/.
 *
 * ponytail: the URL is constructed optimistically. Only general teaching
 * spaces have pages, so a department-restricted room 404s on UBC's site;
 * their room index sits behind bot protection, so the upgrade path (vendor
 * the valid slugs, show the link only when real) waits until 404s annoy.
 */
export function roomDetailsUrl(
  building: string | null | undefined,
  room: string | null | undefined,
): string | null {
  if (!building || !room) return null;
  const slug = `${building}-${room}`.toLowerCase().replace(/\s+/g, '-');
  return `https://learningspaces.ubc.ca/classrooms/${encodeURIComponent(slug)}/`;
}

export function formatRoom(m: {
  building: string | null;
  room: string | null;
  floor: string | null;
}): string | null {
  if (!m.building && !m.room) return null;
  const where = [m.building, m.room].filter(Boolean).join(' ');
  return m.floor && !(m.room ?? '').startsWith(m.floor) ? `${where} · Floor ${m.floor}` : where;
}
