import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deriveSettingsProfile, splitRealName } from "@/lib/register";
import bcrypt from "bcryptjs";

const asText = (value: unknown) => (typeof value === "string" ? value : "");

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { displayName: true, realName: true, username: true, email: true, emailReminders: true },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // The form edits first/last name like signup does (#126); realName is one
  // column, so split it back apart here rather than storing the halves.
  return NextResponse.json({ ...user, ...splitRealName(user.realName) });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { displayName, firstName, lastName, email, emailReminders, currentPassword, newPassword } =
    await req.json();

  const updates: Record<string, string | boolean | null> = {};

  // The profile form always posts all three name fields together; the password
  // form posts none of them, so leave the names alone unless one is present.
  if (displayName !== undefined || firstName !== undefined || lastName !== undefined) {
    const names = deriveSettingsProfile({
      firstName: asText(firstName),
      lastName: asText(lastName),
      displayName: asText(displayName),
      username: session.user.username,
    });
    updates.displayName = names.displayName;
    updates.realName = names.realName;
  }

  if (emailReminders !== undefined) {
    updates.emailReminders = Boolean(emailReminders);
  }

  if (email !== undefined) {
    const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (trimmed === "") {
      updates.email = null;
    } else if (trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
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
