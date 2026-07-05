import { describe, it, expect } from "vitest";
import {
  buildOpenMeteoUrl,
  parseWeatherResponse,
  shouldFetchWeather,
  degToCompass,
  weatherIcon,
  formatWeather,
  WEATHER_LOOKAHEAD_MS,
  WEATHER_REFRESH_MS,
  type GameWeather,
} from "@/lib/weather";

describe("degToCompass", () => {
  it("maps cardinal and intercardinal degrees", () => {
    expect(degToCompass(0)).toBe("N");
    expect(degToCompass(45)).toBe("NE");
    expect(degToCompass(90)).toBe("E");
    expect(degToCompass(180)).toBe("S");
    expect(degToCompass(270)).toBe("W");
    expect(degToCompass(315)).toBe("NW");
  });

  it("wraps at 360 and rounds to the nearest sector", () => {
    expect(degToCompass(360)).toBe("N");
    expect(degToCompass(350)).toBe("N");
    expect(degToCompass(-90)).toBe("W");
  });
});

describe("weatherIcon", () => {
  it("maps WMO codes to icons", () => {
    expect(weatherIcon(0)).toBe("☀"); // clear
    expect(weatherIcon(3)).toBe("☁"); // overcast
    expect(weatherIcon(45)).toBe("🌫"); // fog
    expect(weatherIcon(63)).toBe("🌧"); // rain
    expect(weatherIcon(73)).toBe("❄"); // snow
    expect(weatherIcon(96)).toBe("⛈"); // thunderstorm
  });
});

describe("formatWeather", () => {
  const base: GameWeather = { temp_f: 38, wind_mph: 18, wind_dir: "NW", precip_chance: 10, code: 3, fetched_at: "" };

  it("shows temp and wind, hides low precip", () => {
    expect(formatWeather(base)).toBe("38°F · Wind 18mph NW");
  });

  it("adds precip when >= 30%", () => {
    expect(formatWeather({ ...base, precip_chance: 60 })).toBe("38°F · Wind 18mph NW · 60% precip");
  });

  it("omits wind direction when unknown", () => {
    expect(formatWeather({ ...base, wind_dir: "" })).toBe("38°F · Wind 18mph");
  });
});

describe("buildOpenMeteoUrl", () => {
  it("requests fahrenheit/mph in UTC spanning the kickoff day", () => {
    const url = buildOpenMeteoUrl(47.5952, -122.3316, new Date("2026-09-14T17:00:00Z"));
    expect(url).toContain("latitude=47.5952");
    expect(url).toContain("longitude=-122.3316");
    expect(url).toContain("temperature_unit=fahrenheit");
    expect(url).toContain("wind_speed_unit=mph");
    expect(url).toContain("timezone=UTC");
    expect(url).toContain("start_date=2026-09-14");
    expect(url).toContain("end_date=2026-09-15");
  });
});

describe("parseWeatherResponse", () => {
  const response = {
    hourly: {
      time: ["2026-09-14T16:00", "2026-09-14T17:00", "2026-09-14T18:00"],
      temperature_2m: [70.4, 72.6, 74],
      precipitation_probability: [5, 40, 10],
      weather_code: [0, 61, 3],
      wind_speed_10m: [10, 12.3, 14],
      wind_direction_10m: [0, 90, 180],
    },
  };

  it("picks the hour nearest kickoff and rounds", () => {
    const w = parseWeatherResponse(response, new Date("2026-09-14T17:10:00Z"), new Date("2026-09-14T00:00:00Z"))!;
    expect(w.temp_f).toBe(73); // 72.6 rounded
    expect(w.wind_mph).toBe(12); // 12.3 rounded
    expect(w.wind_dir).toBe("E"); // 90°
    expect(w.precip_chance).toBe(40);
    expect(w.code).toBe(61);
    expect(w.fetched_at).toBe("2026-09-14T00:00:00.000Z");
  });

  it("returns null when hourly data is missing", () => {
    expect(parseWeatherResponse({}, new Date())).toBeNull();
    expect(parseWeatherResponse({ hourly: { time: [] } }, new Date())).toBeNull();
  });

  it("returns null when temperature or wind is absent at the matched hour", () => {
    const bad = { hourly: { time: ["2026-09-14T17:00"], wind_speed_10m: [12] } };
    expect(parseWeatherResponse(bad, new Date("2026-09-14T17:00:00Z"))).toBeNull();
  });

  it("defaults precip to 0 and wind_dir to '' when those fields are missing", () => {
    const partial = { hourly: { time: ["2026-09-14T17:00"], temperature_2m: [50], wind_speed_10m: [8] } };
    const w = parseWeatherResponse(partial, new Date("2026-09-14T17:00:00Z"))!;
    expect(w.precip_chance).toBe(0);
    expect(w.wind_dir).toBe("");
    expect(w.code).toBe(0);
  });
});

describe("shouldFetchWeather", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const soon = new Date(now.getTime() + 60 * 60 * 1000); // +1h
  const outdoor = { indoor: false, status: "SCHEDULED", kickoff: soon };

  it("skips indoor stadiums", () => {
    expect(shouldFetchWeather({ ...outdoor, indoor: true }, null, now)).toBe(false);
  });

  it("skips finished games", () => {
    expect(shouldFetchWeather({ ...outdoor, status: "FINAL" }, null, now)).toBe(false);
  });

  it("skips games beyond the lookahead window", () => {
    const far = new Date(now.getTime() + WEATHER_LOOKAHEAD_MS + 60 * 60 * 1000);
    expect(shouldFetchWeather({ ...outdoor, kickoff: far }, null, now)).toBe(false);
  });

  it("skips games that ended long ago", () => {
    const old = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    expect(shouldFetchWeather({ ...outdoor, kickoff: old }, null, now)).toBe(false);
  });

  it("fetches an in-window game with no cached forecast", () => {
    expect(shouldFetchWeather(outdoor, null, now)).toBe(true);
  });

  it("skips when the cached forecast is still fresh", () => {
    const fresh = new Date(now.getTime() - WEATHER_REFRESH_MS + 60 * 1000).toISOString();
    expect(shouldFetchWeather(outdoor, fresh, now)).toBe(false);
  });

  it("re-fetches when the cached forecast is stale", () => {
    const stale = new Date(now.getTime() - WEATHER_REFRESH_MS - 60 * 1000).toISOString();
    expect(shouldFetchWeather(outdoor, stale, now)).toBe(true);
  });
});
