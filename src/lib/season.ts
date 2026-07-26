// Pure season-structure builder. Kept out of the API route so it can be
// unit-tested without Prisma and reused by the upcoming season simulator
// (see src/__tests__/season.test.ts). The route does the Prisma `create`.

export type SeasonWeek = {
  weekNumber: number;
  label: string;
  isPlayoff: boolean;
  pointValue: number;
  pickDeadline: Date;
};

/**
 * Build the 22 week definitions for a season:
 * - weeks 1-18: regular season, 1 point, deadline placeholder (${year}-09-01, admin updates)
 * - weeks 19-22: playoffs — Wild Card (2), Divisional (3), Conference Championship (4),
 *   Super Bowl (5). Playoff deadlines fall in the following calendar year.
 */
export function buildSeasonWeeks(year: number): SeasonWeek[] {
  return [
    // Regular season weeks 1-18
    ...Array.from({ length: 18 }, (_, i) => ({
      weekNumber: i + 1,
      label: `Week ${i + 1}`,
      isPlayoff: false,
      pointValue: 1,
      pickDeadline: new Date(`${year}-09-01`), // placeholder, admin updates
    })),
    // Playoff rounds
    { weekNumber: 19, label: "Wild Card", isPlayoff: true, pointValue: 2, pickDeadline: new Date(`${year + 1}-01-01`) },
    { weekNumber: 20, label: "Divisional", isPlayoff: true, pointValue: 3, pickDeadline: new Date(`${year + 1}-01-01`) },
    { weekNumber: 21, label: "Conference Championship", isPlayoff: true, pointValue: 4, pickDeadline: new Date(`${year + 1}-01-01`) },
    { weekNumber: 22, label: "Super Bowl", isPlayoff: true, pointValue: 5, pickDeadline: new Date(`${year + 1}-02-01`) },
  ];
}
