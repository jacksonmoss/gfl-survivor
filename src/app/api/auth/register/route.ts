import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkInviteUsable } from "@/lib/invites";
import { deriveProfileNames } from "@/lib/register";

export async function POST(req: NextRequest) {
  const { username, password, firstName, lastName, inviteCode } = await req.json();

  // Only the username + password are required; first/last name are optional.
  if (!username?.trim() || !password || !inviteCode) {
    return NextResponse.json(
      { error: "Username and password are required" },
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

  const normalizedUsername = username.trim();
  const existing = await prisma.user.findUnique({
    where: { username: normalizedUsername },
  });
  if (existing) {
    return NextResponse.json(
      { error: "That username's taken — try another." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { displayName, realName } = deriveProfileNames({
    firstName,
    lastName,
    username: normalizedUsername,
  });

  await prisma.user.create({
    data: {
      username: normalizedUsername,
      passwordHash,
      displayName,
      realName,
      inviteCodeUsed: invite.code,
    },
  });

  return NextResponse.json({ success: true });
}
