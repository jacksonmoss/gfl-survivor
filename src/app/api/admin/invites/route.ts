import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateLeagueCode, normalizeMaxUses } from "@/lib/invites";

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

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  // Reusable league invite. Creating one disables any existing active league
  // code — that's the "rotate" story: the newest enabled multi-use code is the
  // one shared link, and rotating instantly invalidates the previous one.
  if (body?.multiUse) {
    const maxUses = normalizeMaxUses(body.maxUses);
    await prisma.inviteCode.updateMany({
      where: { multiUse: true, disabled: false },
      data: { disabled: true },
    });

    // Retry on the (very unlikely) code collision from the random suffix.
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const invite = await prisma.inviteCode.create({
          data: {
            code: generateLeagueCode(year),
            createdBy: session.user.id,
            multiUse: true,
            maxUses,
          },
        });
        return NextResponse.json(invite);
      } catch {
        // unique-constraint conflict on `code` → regenerate and retry
      }
    }
    return NextResponse.json(
      { error: "Could not generate a unique code, try again" },
      { status: 500 }
    );
  }

  // Legacy per-person single-use code (opaque cuid default).
  const invite = await prisma.inviteCode.create({
    data: { createdBy: session.user.id },
  });

  return NextResponse.json(invite);
}

// Toggle a code's kill switch (disable a shared link, or re-enable it).
export async function PATCH(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, disabled } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || typeof disabled !== "boolean") {
    return NextResponse.json({ error: "id and disabled are required" }, { status: 400 });
  }

  const invite = await prisma.inviteCode.update({
    where: { id },
    data: { disabled },
  });

  return NextResponse.json(invite);
}
