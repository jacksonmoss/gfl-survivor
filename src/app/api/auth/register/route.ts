import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

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
    include: { usedBy: true },
  });

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 400 });
  }

  if (invite.usedBy) {
    return NextResponse.json(
      { error: "Invite code already used" },
      { status: 400 }
    );
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "Invite code has expired" },
      { status: 400 }
    );
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
