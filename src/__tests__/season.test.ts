import { describe, it, expect } from "vitest";
import { buildSeasonWeeks } from "@/lib/season";

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
