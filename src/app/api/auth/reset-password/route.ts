import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { hashResetToken, isResetTokenExpired } from "@/lib/password-reset";

export async function POST(req: NextRequest) {
  const { token, password } = await req.json();

  if (!token || !password) {
    return NextResponse.json(
      { error: "Token and new password are required" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
  });

  if (!record || isResetTokenExpired(record.expiresAt)) {
    // Clean up an expired token if we found one.
    if (record) {
      await prisma.passwordResetToken.delete({ where: { id: record.id } });
    }
    return NextResponse.json(
      { error: "This reset link is invalid or has expired" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Update the password and invalidate all of the user's reset tokens.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
  ]);

  return NextResponse.json({ success: true });
}
