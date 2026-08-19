import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { isDemoMode, shiftKickoffs } from "@/lib/demo";
import { resolveDemoWeek } from "@/lib/demo-week";

// Where the reopened slate's first game lands. Two days out: far enough that
// nothing is locked and the "kicks off in…" text looks like a real upcoming
// week, close enough that the whole slate stays inside the picks page's
// week view.
const FIRST_KICKOFF_AHEAD_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Put a simulated week back the way it started (#161), so the demo can be run
 * again — a customer usually wants a second pass once they've seen what the
 * button does, and a beta install has no other way back.
 *
 * Clears every pick for the week (the customer's included — they're about to
 * make a new one), reopens the games, and slides the slate back into the
 * future, keeping its Thursday/Sunday/Monday shape.
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
  const week = resolved.week;

  if (week.games.length === 0) {
    return NextResponse.json({ error: `${week.label} has no games to reset.` }, { status: 400 });
  }

  const shifted = shiftKickoffs(
    week.games.map((g) => g.kickoff),
    "first",
    new Date(Date.now() + FIRST_KICKOFF_AHEAD_MS),
  );

  const { count: picksCleared } = await prisma.$transaction(
    async (tx) => {
      const cleared = await tx.pick.deleteMany({ where: { weekId: week.id } });

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
      }

      await tx.week.update({
        where: { id: week.id },
        data: { pickDeadline: shifted.reduce((a, b) => (a < b ? a : b)) },
      });

      return cleared;
    },
    { timeout: 20_000 },
  );

  return NextResponse.json({
    week: { id: week.id, weekNumber: week.weekNumber, label: week.label },
    picksCleared,
    gamesReopened: week.games.length,
  });
}
