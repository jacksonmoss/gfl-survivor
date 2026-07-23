import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import {
  computeReminderSlots,
  dueSlots,
  buildReminderEmail,
  DEFAULT_REMINDER_CONFIG,
  HANDLED_REMINDER_STATUSES,
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
  const summary: { slot: string; sent: number; skipped: number; failed: number }[] =
    [];
  let total = 0;

  for (const { slot, kickoff } of slots) {
    // A user needs this reminder if they've opted in, have an email, haven't
    // picked, and don't already have a handled (PENDING/SENT) log for this slot.
    // A prior FAILED log is *not* handled, so those users are re-selected here.
    const recipients = await prisma.user.findMany({
      where: {
        emailReminders: true,
        email: { not: null },
        picks: { none: { weekId: week.id } },
        reminderLogs: {
          none: {
            weekId: week.id,
            slot,
            status: { in: HANDLED_REMINDER_STATUSES },
          },
        },
      },
      select: { id: true, email: true, displayName: true },
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const user of recipients) {
      // Claim the (user, week, slot) as PENDING before sending, so overlapping
      // runs don't double-send. Two cases:
      //   - No row yet: create it. A unique-constraint conflict (P2002) means
      //     another run has it, or a prior FAILED row exists.
      //   - Retry of a FAILED row: flip it FAILED -> PENDING atomically. The
      //     status filter makes this a no-op (count 0) if a concurrent run
      //     already reclaimed it or it's since SENT — in which case, skip.
      try {
        await prisma.reminderLog.create({
          data: { userId: user.id, weekId: week.id, slot, status: "PENDING" },
        });
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e;
        const claimed = await prisma.reminderLog.updateMany({
          where: { userId: user.id, weekId: week.id, slot, status: "FAILED" },
          data: { status: "PENDING", sentAt: now },
        });
        if (claimed.count === 0) {
          skipped++;
          continue;
        }
      }

      const { subject, text, html } = buildReminderEmail({
        displayName: user.displayName,
        weekLabel: week.label,
        slot,
        kickoff,
        appUrl,
        timeZone: config.timeZone,
      });

      // Record the send outcome so a transient SMTP failure is retried next run
      // rather than being silently swallowed by the claim. A returned result
      // (including the SMTP-unconfigured console fallback) counts as sent.
      try {
        await sendMail({ to: user.email!, subject, text, html });
        await prisma.reminderLog.updateMany({
          where: { userId: user.id, weekId: week.id, slot },
          data: { status: "SENT", sentAt: new Date() },
        });
        sent++;
      } catch (e) {
        await prisma.reminderLog.updateMany({
          where: { userId: user.id, weekId: week.id, slot },
          data: { status: "FAILED" },
        });
        console.error(
          `[reminders] send failed for user ${user.id} (${week.label} / ${slot}); will retry:`,
          e
        );
        failed++;
      }
    }

    total += sent;
    summary.push({ slot, sent, skipped, failed });
  }

  return NextResponse.json({
    week: week.label,
    weekNumber: week.weekNumber,
    sent: total,
    slots: summary,
  });
}
