import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkInviteUsable } from "@/lib/invites";
import { claimInviteAndCreateUser } from "@/lib/invite-claim";
import { deriveProfileNames, validateNameFields } from "@/lib/register";

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

  // Bound the free-text identity fields (#137) before any DB work or the ~250ms
  // bcrypt hash — same reasoning as the invite pre-check below.
  const lengths = validateNameFields({ username, firstName, lastName });
  if (!lengths.ok) {
    return NextResponse.json({ error: lengths.error }, { status: 400 });
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
  // This is a fast pre-check so a bad code fails before we spend ~250ms hashing;
  // claimInviteAndCreateUser re-runs it under a row lock, which is what actually
  // enforces the cap against concurrent registrations (#123).
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

  const claim = await claimInviteAndCreateUser(prisma, {
    code: invite.code,
    username: normalizedUsername,
    passwordHash,
    displayName,
    realName,
  });
  if (!claim.ok) {
    return NextResponse.json({ error: claim.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
