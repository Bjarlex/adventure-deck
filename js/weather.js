// Current weather in central Copenhagen from Open-Meteo (free, no key).
// We always send fixed city-centre coordinates, never the phone's location.

const URL_NOW = 'https://api.open-meteo.com/v1/forecast?latitude=55.68&longitude=12.57&current=temperature_2m,precipitation,is_day,weather_code';
// WMO weather codes that mean something is falling: drizzle, rain, freezing rain, snow, showers, thunder.
const WET = (code) => (code >= 51 && code <= 67) || (code >= 71 && code <= 77) || (code >= 80 && code <= 86) || code >= 95;

let cache = null;

/** {isDay, raining, temp, at} or null if offline. Cached for 15 minutes. */
export async function getWeather({ maxAgeMin = 15 } = {}) {
  if (cache && Date.now() - cache.at < maxAgeMin * 60000) return cache;
  try {
    const res = await fetch(URL_NOW, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const c = (await res.json()).current;
    cache = { isDay: c.is_day === 1, raining: (c.precipitation || 0) > 0.1 || WET(c.weather_code), temp: Math.round(c.temperature_2m), at: Date.now() };
  } catch {
    // Offline: keep the last known weather for up to 2 hours, then give up (rain becomes "unknown").
    if (cache && Date.now() - cache.at > 2 * 3600000) cache = null;
  }
  return cache;
}

export const lastWeather = () => cache;
