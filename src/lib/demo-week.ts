// Which week the demo controls act on (#161). Shared by the simulate and reset
// routes so they can never disagree about the target — resetting a different
// week than the one just simulated would be the worst possible bug to hit in
// front of a customer.
//
// Imports Prisma, so it isn't unit-tested directly (same convention as
// src/lib/odds-sync.ts); the pure logic lives in src/lib/demo.ts.

import { prisma } from "@/lib/prisma";

export type DemoWeek = NonNullable<Awaited<ReturnType<typeof findWeek>>>;

async function findWeek(weekId: string) {
  return prisma.week.findUnique({
    where: { id: weekId },
    include: { games: { orderBy: { kickoff: "asc" } }, season: true },
  });
}

export type DemoWeekResult =
  | { ok: true; week: DemoWeek }
  | { ok: false; status: number; error: string };

/**
 * Resolve the week the demo should act on.
 *
 * An explicit `weekId` (what the picks page sends — the week the customer is
 * actually looking at) wins, and must belong to the active season. Without
 * one, fall back to the same "current week" rule the score sync uses: the
 * first week with games that aren't all final, or failing that the last week
 * that has any games, so the controls still work on a week already played out.
 */
export async function resolveDemoWeek(weekId?: unknown): Promise<DemoWeekResult> {
  const season = await prisma.season.findFirst({
    where: { isActive: true },
    include: {
      weeks: {
        orderBy: { weekNumber: "asc" },
        include: { games: { select: { id: true, status: true } } },
      },
    },
  });
  if (!season) return { ok: false, status: 404, error: "No active season." };

  if (typeof weekId === "string" && weekId.length > 0) {
    if (!season.weeks.some((w) => w.id === weekId)) {
      return { ok: false, status: 404, error: "That week isn't part of the active season." };
    }
    const week = await findWeek(weekId);
    if (!week) return { ok: false, status: 404, error: "Week not found." };
    return { ok: true, week };
  }

  const candidate =
    season.weeks.find((w) => w.games.length > 0 && w.games.some((g) => g.status !== "FINAL")) ??
    [...season.weeks].reverse().find((w) => w.games.length > 0);

  if (!candidate) {
    return { ok: false, status: 400, error: "No week has any games yet — import a schedule first." };
  }

  const week = await findWeek(candidate.id);
  if (!week) return { ok: false, status: 404, error: "Week not found." };
  return { ok: true, week };
}

/**
 * The run of consecutive weeks a multi-week simulation should cover (#163):
 * `start`, then the following weeks in the same season, stopping at the first
 * one with no games. A gap means the schedule hasn't reached that far, and
 * jumping over it would leave a hole in the middle of the season.
 */
export async function collectDemoWeeks(start: DemoWeek, count: number): Promise<DemoWeek[]> {
  if (start.games.length === 0) return [];
  const weeks = [start];

  for (let n = 1; n < count; n++) {
    const next = await prisma.week.findUnique({
      where: {
        seasonId_weekNumber: { seasonId: start.seasonId, weekNumber: start.weekNumber + n },
      },
      include: { games: { orderBy: { kickoff: "asc" } }, season: true },
    });
    if (!next || next.games.length === 0) break;
    weeks.push(next);
  }

  return weeks;
}

/**
 * Every week of the active season that has a slate, in order — what "Reset
 * all" acts on, so a multi-week run can be undone in one go rather than a week
 * at a time.
 */
export async function allDemoWeeksWithGames(seasonId: string): Promise<DemoWeek[]> {
  const weeks = await prisma.week.findMany({
    where: { seasonId, games: { some: {} } },
    orderBy: { weekNumber: "asc" },
    include: { games: { orderBy: { kickoff: "asc" } }, season: true },
  });
  return weeks;
}
