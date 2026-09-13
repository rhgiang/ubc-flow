'use server';

import { searchAll, type LiveSearchResult } from '@/lib/search';

/** Thin server-action wrapper so the homepage's debounced client search has
 * something to call directly - searchAll itself stays a plain, testable
 * function with no 'use server' constraints. */
export async function liveSearch(query: string): Promise<LiveSearchResult> {
  return searchAll(query);
}
