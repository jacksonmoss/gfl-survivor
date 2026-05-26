import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
        create: [
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
        ],
      },
    },
    include: { weeks: true },
  });

  return NextResponse.json(season);
}
