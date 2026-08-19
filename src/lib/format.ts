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
