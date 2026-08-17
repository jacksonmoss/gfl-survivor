import { describe, it, expect } from "vitest";
import { buildSeasonWeeks, validateSeasonYear } from "@/lib/season";

// #159: the create path deactivates every season before inserting the new one,
// so a year that fails validation *after* that write leaves the league with no
// active season and no in-app recovery. These guard the pre-check that stops it.
describe("validateSeasonYear", () => {
  it("accepts a plausible new year", () => {
    expect(validateSeasonYear(2026, [2024, 2025])).toEqual({ ok: true });
  });

  it("accepts a year when no seasons exist yet", () => {
    expect(validateSeasonYear(2026)).toEqual({ ok: true });
  });

  it("rejects a duplicate year, naming it", () => {
    const result = validateSeasonYear(2025, [2024, 2025]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("2025") });
  });

  it("rejects non-integers, including a NaN from a blank number input", () => {
    for (const bad of [NaN, 2026.5, "2026", null, undefined]) {
      expect(validateSeasonYear(bad, []).ok).toBe(false);
    }
  });

  it("rejects years outside the allowed range", () => {
    expect(validateSeasonYear(1919, []).ok).toBe(false);
    expect(validateSeasonYear(2201, []).ok).toBe(false);
    // A stray millisecond timestamp is the realistic way this happens.
    expect(validateSeasonYear(Date.now(), []).ok).toBe(false);
  });

  it("accepts the range boundaries", () => {
    expect(validateSeasonYear(1920, []).ok).toBe(true);
    expect(validateSeasonYear(2200, []).ok).toBe(true);
  });
});

describe("buildSeasonWeeks", () => {
  const year = 2026;
  const weeks = buildSeasonWeeks(year);

  it("returns exactly 22 weeks numbered 1-22 in order", () => {
    expect(weeks).toHaveLength(22);
    expect(weeks.map((w) => w.weekNumber)).toEqual(
      Array.from({ length: 22 }, (_, i) => i + 1),
    );
  });

  it("marks weeks 1-18 as regular season worth 1 point", () => {
    for (const w of weeks.slice(0, 18)) {
      expect(w.isPlayoff).toBe(false);
      expect(w.pointValue).toBe(1);
      expect(w.label).toBe(`Week ${w.weekNumber}`);
      expect(w.pickDeadline).toEqual(new Date(`${year}-09-01`));
    }
  });

  it("escalates playoff points 2/3/4/5 with correct labels", () => {
    expect(weeks[18]).toMatchObject({ weekNumber: 19, label: "Wild Card", isPlayoff: true, pointValue: 2 });
    expect(weeks[19]).toMatchObject({ weekNumber: 20, label: "Divisional", isPlayoff: true, pointValue: 3 });
    expect(weeks[20]).toMatchObject({ weekNumber: 21, label: "Conference Championship", isPlayoff: true, pointValue: 4 });
    expect(weeks[21]).toMatchObject({ weekNumber: 22, label: "Super Bowl", isPlayoff: true, pointValue: 5 });
  });

  it("sets playoff deadlines in the following calendar year", () => {
    expect(weeks[18].pickDeadline).toEqual(new Date(`${year + 1}-01-01`)); // Wild Card
    expect(weeks[19].pickDeadline).toEqual(new Date(`${year + 1}-01-01`)); // Divisional
    expect(weeks[20].pickDeadline).toEqual(new Date(`${year + 1}-01-01`)); // Conf Championship
    expect(weeks[21].pickDeadline).toEqual(new Date(`${year + 1}-02-01`)); // Super Bowl
  });

  it("parameterizes the regular-season length, appending the 4 playoff rounds after it", () => {
    // A 19-game regular season → 23 weeks, playoffs at 20-23.
    const bigger = buildSeasonWeeks(year, 19);
    expect(bigger).toHaveLength(23);
    expect(bigger.map((w) => w.weekNumber)).toEqual(
      Array.from({ length: 23 }, (_, i) => i + 1),
    );
    // Week 19 is now the last regular week, not a playoff.
    expect(bigger[18]).toMatchObject({ weekNumber: 19, isPlayoff: false, pointValue: 1 });
    // Playoffs follow, still escalating 2/3/4/5 with the same labels.
    expect(bigger[19]).toMatchObject({ weekNumber: 20, label: "Wild Card", isPlayoff: true, pointValue: 2 });
    expect(bigger[22]).toMatchObject({ weekNumber: 23, label: "Super Bowl", isPlayoff: true, pointValue: 5 });
  });
});
