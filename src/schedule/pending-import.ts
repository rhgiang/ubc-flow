import type { ImportedTerm } from '@/upload/match-schedule';

/**
 * Terms from a Workday import that no schedule holds yet, parked across the
 * navigation into the builder. sessionStorage, not a query string: the payload
 * is a whole timetable, and it must not survive the tab.
 */
const PENDING_TERMS_KEY = 'ubcflow:workday-pending-terms';

export function readPendingTerms(): ImportedTerm[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(PENDING_TERMS_KEY);
    return raw ? (JSON.parse(raw) as ImportedTerm[]) : [];
  } catch {
    return [];
  }
}

export function writePendingTerms(terms: ImportedTerm[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (terms.length === 0) window.sessionStorage.removeItem(PENDING_TERMS_KEY);
    else window.sessionStorage.setItem(PENDING_TERMS_KEY, JSON.stringify(terms));
  } catch {
    // A blocked sessionStorage only costs the follow-up offer, not the import.
  }
}
