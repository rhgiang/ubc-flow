import { NextResponse } from 'next/server';
import { getCampusWeather } from '@/lib/weather';

/**
 * Campus conditions for a page that is already open. The layout passes the
 * observation in at render time, which is enough for a fresh load but not
 * for a tab left open across sunset — weather mode would keep drawing a
 * daylight sky for hours. ThemeToggle polls this while in weather mode.
 *
 * getCampusWeather caches upstream for 30 minutes, so polling costs nothing
 * beyond the round trip.
 */
export async function GET() {
  return NextResponse.json(await getCampusWeather());
}
