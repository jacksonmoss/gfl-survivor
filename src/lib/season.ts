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
 * Build the week definitions for a season:
 * - regular season (weeks 1..`regularWeeks`): 1 point, deadline placeholder (${year}-09-01, admin updates)
 * - 4 playoff rounds follow: Wild Card (2), Divisional (3), Conference Championship (4),
 *   Super Bowl (5). Playoff deadlines fall in the following calendar year.
 *
 * @param regularWeeks number of regular-season weeks (default 18). Playoff week
 *   numbers are relative to this, so a longer/shorter regular season is a config
 *   value, not a code edit.
 */
export function buildSeasonWeeks(year: number, regularWeeks = 18): SeasonWeek[] {
  const playoffs: Omit<SeasonWeek, "weekNumber">[] = [
    { label: "Wild Card", isPlayoff: true, pointValue: 2, pickDeadline: new Date(`${year + 1}-01-01`) },
    { label: "Divisional", isPlayoff: true, pointValue: 3, pickDeadline: new Date(`${year + 1}-01-01`) },
    { label: "Conference Championship", isPlayoff: true, pointValue: 4, pickDeadline: new Date(`${year + 1}-01-01`) },
    { label: "Super Bowl", isPlayoff: true, pointValue: 5, pickDeadline: new Date(`${year + 1}-02-01`) },
  ];
  return [
    // Regular season
    ...Array.from({ length: regularWeeks }, (_, i) => ({
      weekNumber: i + 1,
      label: `Week ${i + 1}`,
      isPlayoff: false,
      pointValue: 1,
      pickDeadline: new Date(`${year}-09-01`), // placeholder, admin updates
    })),
    // Playoff rounds, numbered continuing from the regular season
    ...playoffs.map((p, i) => ({ ...p, weekNumber: regularWeeks + 1 + i })),
  ];
}
