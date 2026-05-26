import { NextResponse } from "next/server";
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

  const invites = await prisma.inviteCode.findMany({
    include: { usedBy: { select: { displayName: true, username: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(invites);
}

export async function POST() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const invite = await prisma.inviteCode.create({
    data: {
      createdBy: session.user.id,
    },
  });

  return NextResponse.json(invite);
}
