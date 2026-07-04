import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import {
  computeReminderSlots,
  dueSlots,
  buildReminderEmail,
  DEFAULT_REMINDER_CONFIG,
} from "@/lib/reminders";

// Constant-time compare so a wrong secret can't be timed. Mismatched lengths
// are unequal by definition.
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Send pick-deadline reminders for the current week. Called on a schedule by an
 * external cron (system cron / Docker sidecar / hosted scheduler), authenticated
 * with a shared secret rather than a user session:
 *
 *   POST /api/admin/reminders/send
 *   Authorization: Bearer $CRON_SECRET
 *
 * Idempotent: each (user, week, slot) is logged before sending, so re-running —
 * or overlapping runs — won't double-email. Safe to poll frequently.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !secretMatches(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const season = await prisma.season.findFirst({
    where: { isActive: true },
    include: {
      weeks: {
        orderBy: { weekNumber: "asc" },
        include: { games: { orderBy: { kickoff: "asc" } } },
      },
    },
  });
  if (!season) {
    return NextResponse.json({ week: null, sent: 0, slots: [] });
  }

  // The week players are still picking for: the earliest one with a game that
  // hasn't kicked off yet.
  const week = season.weeks.find((w) => w.games.some((g) => g.kickoff > now));
  if (!week) {
    return NextResponse.json({ week: null, sent: 0, slots: [] });
  }

  const config = {
    ...DEFAULT_REMINDER_CONFIG,
    ...(process.env.REMINDER_LEAD_HOURS
      ? { regularLeadHours: Number(process.env.REMINDER_LEAD_HOURS) }
      : {}),
  };
  const slots = dueSlots(
    computeReminderSlots(week.games, week.isPlayoff, config),
    now
  );

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const summary: { slot: string; sent: number; skipped: number }[] = [];
  let total = 0;

  for (const { slot, kickoff } of slots) {
    const recipients = await prisma.user.findMany({
      where: {
        emailReminders: true,
        email: { not: null },
        picks: { none: { weekId: week.id } },
        reminderLogs: { none: { weekId: week.id, slot } },
      },
      select: { id: true, email: true, displayName: true },
    });

    let sent = 0;
    let skipped = 0;
    for (const user of recipients) {
      // Claim the (user, week, slot) row before sending. A unique-constraint
      // conflict means a concurrent run already took it — skip.
      try {
        await prisma.reminderLog.create({
          data: { userId: user.id, weekId: week.id, slot },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") {
          skipped++;
          continue;
        }
        throw e;
      }

      const { subject, text, html } = buildReminderEmail({
        displayName: user.displayName,
        weekLabel: week.label,
        slot,
        kickoff,
        appUrl,
        timeZone: config.timeZone,
      });
      await sendMail({ to: user.email!, subject, text, html });
      sent++;
    }

    total += sent;
    summary.push({ slot, sent, skipped });
  }

  return NextResponse.json({
    week: week.label,
    weekNumber: week.weekNumber,
    sent: total,
    slots: summary,
  });
}
