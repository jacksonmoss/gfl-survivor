import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSeasonWeeks } from "@/lib/season";
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

  // Deactivate other seasons
  await prisma.season.updateMany({
    data: { isActive: false },
  });

  const season = await prisma.season.create({
    data: {
      year,
      isActive: true,
      weeks: {
        create: buildSeasonWeeks(year),
      },
    },
    include: { weeks: true },
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
