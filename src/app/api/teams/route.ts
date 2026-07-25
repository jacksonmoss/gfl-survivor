import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateTeamName } from "@/lib/teams";
import { Prisma } from "@/generated/prisma/client";

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teams = await prisma.team.findMany({
    include: { members: { select: { id: true, displayName: true } } },
    orderBy: { name: "asc" },
  });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { teamId: true },
  });

  return NextResponse.json({ teams, myTeamId: user?.teamId });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { action, teamName, teamId, userId } = await req.json();

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

  if (action === "assign") {
    if (!teamId || !userId) {
      return NextResponse.json({ error: "teamId and userId required" }, { status: 400 });
    }
    await prisma.user.update({ where: { id: userId }, data: { teamId } });
    return NextResponse.json({ success: true });
  }

  if (action === "unassign") {
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    await prisma.user.update({ where: { id: userId }, data: { teamId: null } });
    return NextResponse.json({ success: true });
  }

  if (action === "delete") {
    if (!teamId) {
      return NextResponse.json({ error: "teamId required" }, { status: 400 });
    }
    await prisma.user.updateMany({ where: { teamId }, data: { teamId: null } });
    await prisma.team.delete({ where: { id: teamId } });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
