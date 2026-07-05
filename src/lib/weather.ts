// Weather forecast helpers built on Open-Meteo (https://open-meteo.com/) — a
// free, key-less forecast API. All functions here are pure so they can be
// unit-tested without hitting the network; the sync route does the actual
// fetch and persists the result to Game.weatherJson (see the sync route).

/** Shape persisted to Game.weatherJson and returned by /api/picks. */
export interface GameWeather {
  temp_f: number;
  wind_mph: number;
  wind_dir: string; // compass, e.g. "NW" ("" if unknown)
  precip_chance: number; // percent 0-100
  code: number; // WMO weather code (for the display icon)
  fetched_at: string; // ISO timestamp — drives the DB cache staleness check
}

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

/** Only fetch forecasts for games kicking off within this window. */
export const WEATHER_LOOKAHEAD_MS = 72 * 60 * 60 * 1000;
/** Re-fetch a cached forecast no more often than this. */
export const WEATHER_REFRESH_MS = 3 * 60 * 60 * 1000;
/** Keep refreshing up to this long after kickoff (game may be live). */
const WEATHER_TRAILING_MS = 6 * 60 * 60 * 1000;

/**
 * Build the Open-Meteo hourly-forecast URL for a stadium + kickoff. We request
 * the UTC day containing kickoff (plus the next, to avoid falling off the end
 * when nearest-hour matching); parseWeatherResponse picks the matching hour.
 */
export function buildOpenMeteoUrl(lat: number, lon: number, kickoff: Date): string {
  const start = kickoff.toISOString().slice(0, 10);
  const end = new Date(kickoff.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "UTC",
    start_date: start,
    end_date: end,
  });
  return `${OPEN_METEO_BASE}?${params.toString()}`;
}

interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation_probability?: number[];
    weather_code?: number[];
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
  };
}

/**
 * Parse an Open-Meteo response into a GameWeather for the hour nearest kickoff.
 * Returns null if the payload is unusable (missing hourly data, no temp/wind) —
 * callers should treat null as "no weather" and render the card normally.
 */
export function parseWeatherResponse(
  data: OpenMeteoResponse,
  kickoff: Date,
  now: Date = new Date(),
): GameWeather | null {
  const hourly = data?.hourly;
  const times = hourly?.time;
  if (!times || times.length === 0) return null;

  // Open-Meteo returns UTC wall-clock strings ("YYYY-MM-DDTHH:MM") because we
  // request timezone=UTC; append "Z" so Date parses them as UTC, not local.
  const target = kickoff.getTime();
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i] + "Z").getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  if (best < 0) return null;

  const at = (arr: number[] | undefined): number | null => {
    const v = arr?.[best];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const temp = at(hourly.temperature_2m);
  const wind = at(hourly.wind_speed_10m);
  if (temp === null || wind === null) return null;

  const dir = at(hourly.wind_direction_10m);
  const precip = at(hourly.precipitation_probability);
  const code = at(hourly.weather_code);

  return {
    temp_f: Math.round(temp),
    wind_mph: Math.round(wind),
    wind_dir: dir === null ? "" : degToCompass(dir),
    precip_chance: precip === null ? 0 : Math.round(precip),
    code: code === null ? 0 : code,
    fetched_at: now.toISOString(),
  };
}

/** Decide whether a game needs a (re)fetch given its cached forecast. */
export function shouldFetchWeather(
  game: { indoor: boolean; status: string; kickoff: Date },
  existingFetchedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (game.indoor) return false;
  if (game.status === "FINAL") return false;

  const untilKickoff = game.kickoff.getTime() - now.getTime();
  if (untilKickoff > WEATHER_LOOKAHEAD_MS) return false; // too far out
  if (untilKickoff < -WEATHER_TRAILING_MS) return false; // long over

  if (!existingFetchedAt) return true;
  const age = now.getTime() - new Date(existingFetchedAt).getTime();
  return !Number.isFinite(age) || age >= WEATHER_REFRESH_MS;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Meteorological degrees (0=N, 90=E) → 8-point compass label. */
export function degToCompass(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[idx];
}

/** WMO weather code → a single display emoji. */
export function weatherIcon(code: number): string {
  if (code >= 95) return "⛈"; // thunderstorm
  if (code >= 85) return "🌨"; // snow showers
  if (code >= 80) return "🌧"; // rain showers
  if (code >= 71) return "❄"; // snow
  if (code >= 61) return "🌧"; // rain
  if (code >= 51) return "🌦"; // drizzle
  if (code >= 45) return "🌫"; // fog
  if (code >= 2) return "☁"; // cloudy / overcast
  if (code === 1) return "🌤"; // mainly clear
  return "☀"; // clear
}

/** Human-readable summary, e.g. "38°F · Wind 18mph NW · 60% precip". */
export function formatWeather(w: GameWeather): string {
  const parts = [`${w.temp_f}°F`, `Wind ${w.wind_mph}mph${w.wind_dir ? ` ${w.wind_dir}` : ""}`];
  if (w.precip_chance >= 30) parts.push(`${w.precip_chance}% precip`);
  return parts.join(" · ");
}
