import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { displayName: true, username: true, email: true, teamId: true, team: { select: { name: true } } },
  });

  return NextResponse.json(user);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { displayName, email, currentPassword, newPassword } = await req.json();

  const updates: Record<string, string | null> = {};

  if (displayName) {
    updates.displayName = displayName;
  }

  if (email !== undefined) {
    const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (trimmed === "") {
      updates.email = null;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json(
        { error: "Please enter a valid email address" },
        { status: 400 }
      );
    } else {
      const existing = await prisma.user.findUnique({ where: { email: trimmed } });
      if (existing && existing.id !== session.user.id) {
        return NextResponse.json(
          { error: "That email is already in use" },
          { status: 400 }
        );
      }
      updates.email = trimmed;
    }
  }

  if (newPassword) {
    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current password is required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "New password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 }
      );
    }

    updates.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: updates,
  });

  return NextResponse.json({ success: true });
}
