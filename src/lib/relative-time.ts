/**
 * "3 days ago", "last month" - the age of a review, in the form UW Flow and
 * every other review site states it.
 *
 * Intl.RelativeTimeFormat rather than a date library: it is in the platform,
 * it handles the plural and the "yesterday"/"last week" wording itself, and
 * this is the only place in the app that needs any of it.
 */
const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  // Weeks per month and months per year: the point is a readable label, not an
  // exact interval, and the unit above it takes over well before the drift
  // could round anything to the wrong number.
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

const FORMATTER = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(date: Date, now: Date = new Date()): string {
  let delta = (date.getTime() - now.getTime()) / 1000;
  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(delta) < amount) return FORMATTER.format(Math.round(delta), unit);
    delta /= amount;
  }
  // Unreachable: the last division is infinite.
  return FORMATTER.format(Math.round(delta), 'year');
}
