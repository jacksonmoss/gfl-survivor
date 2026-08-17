import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSeasonWeeks, validateSeasonYear } from "@/lib/season";
import { computeRolloverMemberships } from "@/lib/rosters";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const seasons = await prisma.season.findMany({
    include: {
      weeks: {
        orderBy: { weekNumber: "asc" },
        include: { _count: { select: { games: true, picks: true } } },
      },
    },
    orderBy: { year: "desc" },
  });

  return NextResponse.json(seasons);
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { year } = await req.json();

  // Validate before touching anything. The deactivate below is a blanket write,
  // so a create that fails afterwards (duplicate year hitting Season.year's
  // unique constraint) used to leave every season inactive — picks, teams, sync
  // and reminders all key off isActive, so the whole league stopped (#159).
  const existing = await prisma.season.findMany({ select: { year: true } });
  const check = validateSeasonYear(year, existing.map((s) => s.year));
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 409 });
  }

  // Deactivate-then-create in one transaction, so any failure rolls the
  // deactivate back rather than stranding the league with no active season.
  const season = await prisma.$transaction(async (tx) => {
    await tx.season.updateMany({ data: { isActive: false } });
    return tx.season.create({
      data: {
        year,
        isActive: true,
        weeks: {
          create: buildSeasonWeeks(year),
        },
      },
      include: { weeks: true },
    });
  });

  // Roll rosters over from the most-recent prior season (#120) as the editable
  // default. Skip rows whose team or user no longer exists; empty if no prior.
  const prior = await prisma.season.findFirst({
    where: { year: { lt: year } },
    orderBy: { year: "desc" },
    select: { id: true },
  });
  if (prior) {
    const [priorMemberships, teams, users] = await Promise.all([
      prisma.teamMembership.findMany({
        where: { seasonId: prior.id },
        select: { userId: true, teamId: true },
      }),
      prisma.team.findMany({ select: { id: true } }),
      prisma.user.findMany({ select: { id: true } }),
    ]);
    const rollover = computeRolloverMemberships(
      priorMemberships,
      new Set(teams.map((t) => t.id)),
      new Set(users.map((u) => u.id))
    );
    if (rollover.length > 0) {
      await prisma.teamMembership.createMany({
        data: rollover.map((m) => ({ ...m, seasonId: season.id })),
      });
    }
  }

  return NextResponse.json(season);
}

/**
 * Switch which season is active.
 *
 * Before this existed, `isActive` was only ever written at creation time, so
 * the active season was whichever was created last — with no way to correct a
 * mistake, reactivate a prior season, or recover from a league left with none
 * active (#159). Everything user-facing keys off `isActive`: picks, teams,
 * score sync and reminders.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { seasonId } = await req.json();
  if (typeof seasonId !== "string" || seasonId.length === 0) {
    return NextResponse.json({ error: "seasonId is required." }, { status: 400 });
  }

  const target = await prisma.season.findUnique({ where: { id: seasonId }, select: { id: true } });
  if (!target) {
    return NextResponse.json({ error: "Season not found." }, { status: 404 });
  }

  // One transaction, so there is never a moment with zero (or two) active
  // seasons visible to a concurrent request.
  const season = await prisma.$transaction(async (tx) => {
    await tx.season.updateMany({ data: { isActive: false } });
    return tx.season.update({ where: { id: seasonId }, data: { isActive: true } });
  });

  return NextResponse.json(season);
}
