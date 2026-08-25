/**
 * Live campus weather for the sky background's "weather" theme mode.
 *
 * Open-Meteo: free, no API key, no signup. Coordinates are UBC Vancouver —
 * hardcoded rather than geolocated, because the sky should show campus
 * conditions, not the viewer's (and it avoids a permission prompt).
 */

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'storm';

export type WeatherNow = {
  condition: WeatherCondition;
  /** 0–100 */
  cloudCover: number;
  isDay: boolean;
};

/** WMO weather interpretation codes → the handful of skies we can draw. */
function conditionFromCode(code: number): WeatherCondition {
  if (code === 0) return 'clear';
  if (code <= 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

const URL =
  'https://api.open-meteo.com/v1/forecast?latitude=49.2606&longitude=-123.246' +
  '&current=weather_code,cloud_cover,is_day';

/** Null on any failure — the sky just falls back to its default clouds. */
export async function getCampusWeather(): Promise<WeatherNow | null> {
  try {
    const res = await fetch(URL, { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: { weather_code?: number; cloud_cover?: number; is_day?: number };
    };
    const c = data.current;
    if (!c || typeof c.weather_code !== 'number') return null;
    return {
      condition: conditionFromCode(c.weather_code),
      cloudCover: typeof c.cloud_cover === 'number' ? c.cloud_cover : 50,
      isDay: c.is_day !== 0,
    };
  } catch {
    return null;
  }
}
