import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teams = await prisma.team.findMany({
    include: {
      members: {
        select: { id: true, displayName: true },
      },
    },
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

  const { action, teamName, teamId } = await req.json();

  if (action === "create") {
    if (!teamName || teamName.trim().length === 0) {
      return NextResponse.json({ error: "Team name is required" }, { status: 400 });
    }

    const existing = await prisma.team.findUnique({
      where: { name: teamName.trim() },
    });

    if (existing) {
      return NextResponse.json({ error: "Team name already taken" }, { status: 400 });
    }

    const team = await prisma.team.create({
      data: { name: teamName.trim() },
    });

    await prisma.user.update({
      where: { id: session.user.id },
      data: { teamId: team.id },
    });

    return NextResponse.json(team);
  }

  if (action === "join") {
    if (!teamId) {
      return NextResponse.json({ error: "Team ID is required" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { teamId },
    });

    return NextResponse.json({ success: true });
  }

  if (action === "leave") {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { teamId: null },
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
