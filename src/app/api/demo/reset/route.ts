import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { isDemoMode, shiftKickoffs, reopenedWeekAnchor } from "@/lib/demo";
import { resolveDemoWeek, allDemoWeeksWithGames } from "@/lib/demo-week";

/**
 * Put simulated weeks back the way they started (#161; whole-run reset in
 * #163), so the demo can be run again — a customer usually wants a second pass
 * once they've seen what the button does, and a beta install has no other way
 * back.
 *
 * Clears every pick for the weeks it touches (the customer's included — they're
 * about to make new ones), reopens the games, and slides each slate back into
 * the future a week apart, keeping its Thursday/Sunday/Monday shape.
 *
 * `all: true` resets every week of the season that has a slate, which is how a
 * four-week run is undone in one press instead of four.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDemoMode()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const resolved = await resolveDemoWeek(body?.weekId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const all = body?.all === true;
  const weeks = all
    ? await allDemoWeeksWithGames(resolved.week.seasonId)
    : [resolved.week];

  if (weeks.length === 0 || weeks.every((w) => w.games.length === 0)) {
    return NextResponse.json({ error: `${resolved.week.label} has no games to reset.` }, { status: 400 });
  }

  const now = new Date();
  let picksCleared = 0;
  let gamesReopened = 0;

  for (const [index, week] of weeks.entries()) {
    if (week.games.length === 0) continue;

    const shifted = shiftKickoffs(
      week.games.map((g) => g.kickoff),
      "first",
      reopenedWeekAnchor(index, now),
    );

    await prisma.$transaction(
      async (tx) => {
        const cleared = await tx.pick.deleteMany({ where: { weekId: week.id } });
        picksCleared += cleared.count;

        for (const [i, game] of week.games.entries()) {
          await tx.game.update({
            where: { id: game.id },
            data: {
              homeScore: null,
              awayScore: null,
              status: "SCHEDULED",
              kickoff: shifted[i],
              // Drop the cached forecast: it was fetched for the old kickoff and
              // would be stale for the new one. The sync refetches on demand.
              // DbNull, not null — Prisma reads a bare null on a Json field as
              // "leave it alone".
              weatherJson: Prisma.DbNull,
            },
          });
          gamesReopened++;
        }

        await tx.week.update({
          where: { id: week.id },
          data: { pickDeadline: shifted.reduce((a, b) => (a < b ? a : b)) },
        });
      },
      { timeout: 20_000 },
    );
  }

  return NextResponse.json({
    week: { id: resolved.week.id, weekNumber: resolved.week.weekNumber, label: resolved.week.label },
    weeksReset: weeks.filter((w) => w.games.length > 0).map((w) => w.label),
    picksCleared,
    gamesReopened,
  });
}
