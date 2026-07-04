import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
} from "@/lib/password-reset";

// Always returns success regardless of whether the account/email exists, to
// avoid leaking which usernames or emails are registered.
export async function POST(req: NextRequest) {
  const { identifier } = await req.json();

  if (!identifier || typeof identifier !== "string") {
    return NextResponse.json(
      { error: "Username or email is required" },
      { status: 400 }
    );
  }

  const value = identifier.trim();
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: value }, { email: value.toLowerCase() }],
    },
  });

  // Only proceed if we found a user who has an email on file.
  if (user?.email) {
    const token = generateResetToken();

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: resetTokenExpiry(),
      },
    });

    // Opportunistic cleanup: purge this user's expired tokens so they don't
    // accumulate. Expired tokens are already rejected at use time; this just
    // keeps the table tidy without needing a cron job.
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });

    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await sendMail({
      to: user.email,
      subject: "Reset your GFL Survivor password",
      text:
        `Hi ${user.displayName},\n\n` +
        `Someone requested a password reset for your GFL Survivor account.\n` +
        `Click the link below to choose a new password. It expires in 1 hour.\n\n` +
        `${resetUrl}\n\n` +
        `If you didn't request this, you can ignore this email.`,
    });
  }

  return NextResponse.json({ success: true });
}
