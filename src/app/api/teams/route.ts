import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateTeamName } from "@/lib/teams";
import { rostersLocked } from "@/lib/rosters";
import { Prisma } from "@/generated/prisma/client";

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** The active season plus whether its rosters are locked (first game kicked off). */
async function getActiveSeasonLock() {
  const season = await prisma.season.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (!season) return { season: null, locked: false };
  const firstGame = await prisma.game.findFirst({
    where: { week: { seasonId: season.id } },
    orderBy: { kickoff: "asc" },
    select: { kickoff: true },
  });
  return { season, locked: rostersLocked(firstGame?.kickoff ?? null, new Date()) };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { season, locked } = await getActiveSeasonLock();

  const teams = await prisma.team.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Members are the active season's memberships (rosters reset per season).
  const memberships = season
    ? await prisma.teamMembership.findMany({
        where: { seasonId: season.id },
        select: { teamId: true, user: { select: { id: true, displayName: true } } },
      })
    : [];

  const membersByTeam = new Map<string, { id: string; displayName: string }[]>();
  for (const m of memberships) {
    if (!membersByTeam.has(m.teamId)) membersByTeam.set(m.teamId, []);
    membersByTeam.get(m.teamId)!.push(m.user);
  }

  const teamsWithMembers = teams.map((t) => ({
    ...t,
    members: membersByTeam.get(t.id) ?? [],
  }));
  const myTeamId =
    memberships.find((m) => m.user.id === session.user.id)?.teamId ?? null;

  return NextResponse.json({ teams: teamsWithMembers, myTeamId, locked });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { action, teamName, teamId, userId, override } = await req.json();

  if (action === "create") {
    const trimmed = teamName?.trim();
    const existing = trimmed ? await prisma.team.findUnique({ where: { name: trimmed } }) : null;
    const check = validateTeamName(teamName, existing);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    try {
      const team = await prisma.team.create({ data: { name: check.name } });
      return NextResponse.json(team);
    } catch (e) {
      if (isUniqueViolation(e)) {
        return NextResponse.json({ error: "Team name already taken" }, { status: 400 });
      }
      throw e;
    }
  }

  if (action === "rename") {
    if (!teamId) {
      return NextResponse.json({ error: "teamId required" }, { status: 400 });
    }
    const trimmed = teamName?.trim();
    const existing = trimmed ? await prisma.team.findUnique({ where: { name: trimmed } }) : null;
    const check = validateTeamName(teamName, existing, teamId);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    try {
      const team = await prisma.team.update({ where: { id: teamId }, data: { name: check.name } });
      return NextResponse.json(team);
    } catch (e) {
      if (isUniqueViolation(e)) {
        return NextResponse.json({ error: "Team name already taken" }, { status: 400 });
      }
      throw e;
    }
  }

  // Roster edits (assign / unassign / delete) are season-scoped and lock once
  // the active season's first game kicks off — unless an explicit admin override
  // is passed. There must be an active season to edit rosters for.
  if (action === "assign" || action === "unassign" || action === "delete") {
    const { season, locked } = await getActiveSeasonLock();
    if (!season) {
      return NextResponse.json({ error: "No active season" }, { status: 400 });
    }
    if (locked && override !== true) {
      return NextResponse.json(
        { error: "Rosters are locked — the season has started. Use the override to edit." },
        { status: 409 }
      );
    }

    if (action === "assign") {
      if (!teamId || !userId) {
        return NextResponse.json({ error: "teamId and userId required" }, { status: 400 });
      }
      await prisma.teamMembership.upsert({
        where: { userId_seasonId: { userId, seasonId: season.id } },
        create: { userId, seasonId: season.id, teamId },
        update: { teamId },
      });
      return NextResponse.json({ success: true });
    }

    if (action === "unassign") {
      if (!userId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
      }
      await prisma.teamMembership.deleteMany({ where: { userId, seasonId: season.id } });
      return NextResponse.json({ success: true });
    }

    // delete: remove the team entity. Refuse if it has history in another season
    // (deleting would rewrite past rosters); otherwise drop its active-season
    // memberships and the team.
    if (!teamId) {
      return NextResponse.json({ error: "teamId required" }, { status: 400 });
    }
    const otherSeasonUse = await prisma.teamMembership.count({
      where: { teamId, seasonId: { not: season.id } },
    });
    if (otherSeasonUse > 0) {
      return NextResponse.json(
        { error: "Team has roster history in past seasons and can't be deleted." },
        { status: 409 }
      );
    }
    await prisma.teamMembership.deleteMany({ where: { teamId } });
    await prisma.team.delete({ where: { id: teamId } });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
