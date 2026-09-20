// src/canvas/parse-ics.ts
import { vancouverEndOfDayUtc, zonedToUtc } from './tz';

export type FeedItem = {
  uid: string;
  kind: 'assignment' | 'event';
  title: string;
  courseName: string;
  dueAt: Date;
  allDay: boolean;
  url: string | null;
};

export type ParsedFeed = { items: FeedItem[]; skipped: number };

/** RFC 5545 folding: a line beginning with a space or tab continues the
 *  previous line. Canvas folds long SUMMARY and DESCRIPTION values. */
export function unfoldLines(ics: string): string[] {
  const out: string[] = [];
  for (const raw of ics.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else if (raw.length > 0) {
      out.push(raw);
    }
  }
  return out;
}

/** "NAME;P1=a;P2=b:value" into its three parts. Property names and parameter
 *  names are case-insensitive per the RFC, so they are upper-cased here. */
function splitProperty(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rawParams] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/** Text values escape commas, semicolons and newlines. */
function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** "Title [Course]" into its two halves. Only a TRAILING bracket is the
 *  course; "Quiz [open book] 2" keeps its bracket in the title. */
export function splitSummary(summary: string): { title: string; courseName: string } {
  const m = summary.match(/^(.*?)\s*\[([^[\]]+)\]\s*$/);
  if (!m) return { title: summary.trim(), courseName: '' };
  return { title: m[1].trim(), courseName: m[2].trim() };
}

/** A DTSTART value with its parameters into a UTC instant, or null when it
 *  cannot be read. Three shapes Canvas emits: VALUE=DATE (all day), a UTC
 *  date-time ending in Z, and a wall-clock date-time with a TZID. */
function parseDtStart(value: string, params: Record<string, string>): { at: Date; allDay: boolean } | null {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    if (!/^\d{8}$/.test(value)) return null;
    return { at: vancouverEndOfDayUtc(value), allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (m[7] === 'Z') return { at: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  const tz = params.TZID;
  if (!tz) return null;
  try {
    return { at: zonedToUtc(y, mo, d, h, mi, s, tz), allDay: false };
  } catch {
    return null;
  }
}

export function parseCanvasFeed(ics: string): ParsedFeed {
  const items: FeedItem[] = [];
  let skipped = 0;
  let current: Record<string, { params: Record<string, string>; value: string }> | null = null;

  // Closes out whatever event is open: parsed into an item, or counted as
  // skipped. Called on END:VEVENT, on a BEGIN:VEVENT that finds one already
  // open, and once more after the loop for an event the feed never closed.
  // One function so those three sites cannot drift apart.
  const finish = () => {
    if (!current) return;
    const item = toItem(current);
    if (item) items.push(item);
    else skipped += 1;
    current = null;
  };

  for (const line of unfoldLines(ics)) {
    if (line === 'BEGIN:VEVENT') {
      finish();
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      finish();
      continue;
    }
    if (!current) continue;
    const prop = splitProperty(line);
    // First occurrence wins; Canvas does not repeat properties, and a
    // repeated one would be a malformed event, not a second value.
    if (prop && !(prop.name in current)) current[prop.name] = { params: prop.params, value: prop.value };
  }
  finish();

  return { items, skipped };
}

function toItem(p: Record<string, { params: Record<string, string>; value: string }>): FeedItem | null {
  const uid = p.UID?.value.trim();
  const dtstart = p.DTSTART;
  if (!uid || !dtstart) return null;
  const when = parseDtStart(dtstart.value.trim(), dtstart.params);
  if (!when) return null;
  const { title, courseName } = splitSummary(unescapeText(p.SUMMARY?.value ?? ''));
  return {
    uid,
    kind: /assignment/i.test(uid) ? 'assignment' : 'event',
    title,
    courseName,
    dueAt: when.at,
    allDay: when.allDay,
    url: p.URL ? unescapeText(p.URL.value.trim()) || null : null,
  };
}
