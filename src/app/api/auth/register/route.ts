import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkInviteUsable } from "@/lib/invites";

export async function POST(req: NextRequest) {
  const { username, password, displayName, inviteCode } = await req.json();

  if (!username || !password || !displayName || !inviteCode) {
    return NextResponse.json(
      { error: "All fields are required" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const invite = await prisma.inviteCode.findUnique({
    where: { code: inviteCode },
    include: { _count: { select: { usedBy: true } } },
  });

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 400 });
  }

  // Single-use codes reject once consumed; multi-use league codes stay open
  // until disabled, expired, or at their optional cap. See src/lib/invites.ts.
  // (The cap isn't enforced atomically across concurrent registrations — fine
  // for a small league; a couple over the cap at worst.)
  const usable = checkInviteUsable(invite, invite._count.usedBy);
  if (!usable.ok) {
    return NextResponse.json({ error: usable.error }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json(
      { error: "Username already taken" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      username,
      passwordHash,
      displayName,
      inviteCodeUsed: invite.code,
    },
  });

  return NextResponse.json({ success: true });
}
