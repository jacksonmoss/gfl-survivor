// Pure logic for pick-deadline reminders. No Prisma/NextAuth here — the route
// (src/app/api/admin/reminders/send/route.ts) does the DB glue and calls these.
//
// Scheduling differs by phase of the season:
//   - Regular season (weeks 1-18): two reminder slots — before the Thursday
//     night game, and before the earliest Sunday game. A week with no Thursday
//     game simply skips that slot.
//   - Playoffs (weeks 19-22): a single slot on the morning of the week's first
//     game, whatever day it falls on (Wild Card weekend can start Saturday).

export type ReminderSlot = "THURSDAY" | "SUNDAY" | "PLAYOFF";

export interface ReminderConfig {
  /** IANA timezone the NFL schedule is reasoned about in. */
  timeZone: string;
  /** Hours before kickoff the Thursday/Sunday reminder window opens. */
  regularLeadHours: number;
  /** Local hour (0-23) that counts as "morning of" for playoff weeks. */
  playoffMorningHour: number;
}

// The league is US-based; NFL kickoffs are naturally reasoned about in Eastern.
export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  timeZone: "America/New_York",
  regularLeadHours: 3,
  playoffMorningHour: 9,
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Day of week (0=Sun..6=Sat) of an instant in the given timezone. This must be
 * timezone-aware: a Thursday-night kickoff (8:15pm ET) is already Friday in UTC,
 * so a naive UTC weekday would misclassify it.
 */
export function zonedWeekday(d: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(d);
  return WEEKDAY_INDEX[short];
}

/** Milliseconds the wall clock in `timeZone` is ahead of UTC at instant `d`. */
function tzOffsetMs(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUTC - d.getTime();
}

/**
 * The instant of `hour:00` local time on the calendar day (in `timeZone`) that
 * contains `d`. Used to anchor a playoff reminder to "the morning of" the game.
 */
export function zonedMorningOf(d: Date, hour: number, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const utcGuess = Date.UTC(get("year"), get("month") - 1, get("day"), hour);
  return new Date(utcGuess - tzOffsetMs(new Date(utcGuess), timeZone));
}

export interface SlotWindow {
  slot: ReminderSlot;
  /** Kickoff of the game this slot reminds about. */
  kickoff: Date;
  /** When the reminder becomes eligible to send. */
  windowOpensAt: Date;
}

/**
 * The reminder slots that exist for a week's games, each with the instant its
 * send window opens. Returns [] for a week with no games.
 */
export function computeReminderSlots(
  games: { kickoff: Date }[],
  isPlayoff: boolean,
  config: ReminderConfig = DEFAULT_REMINDER_CONFIG
): SlotWindow[] {
  if (games.length === 0) return [];
  const sorted = [...games].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());

  if (isPlayoff) {
    const first = sorted[0].kickoff;
    return [
      {
        slot: "PLAYOFF",
        kickoff: first,
        windowOpensAt: zonedMorningOf(first, config.playoffMorningHour, config.timeZone),
      },
    ];
  }

  const leadMs = config.regularLeadHours * 3_600_000;
  const slots: SlotWindow[] = [];
  const thursday = sorted.find((g) => zonedWeekday(g.kickoff, config.timeZone) === 4);
  if (thursday) {
    slots.push({
      slot: "THURSDAY",
      kickoff: thursday.kickoff,
      windowOpensAt: new Date(thursday.kickoff.getTime() - leadMs),
    });
  }
  const sunday = sorted.find((g) => zonedWeekday(g.kickoff, config.timeZone) === 0);
  if (sunday) {
    slots.push({
      slot: "SUNDAY",
      kickoff: sunday.kickoff,
      windowOpensAt: new Date(sunday.kickoff.getTime() - leadMs),
    });
  }
  return slots;
}

/**
 * Slots whose window is currently open: the send time has arrived but the game
 * hasn't kicked off yet (a missed slot is dropped rather than sent late).
 */
export function dueSlots(slots: SlotWindow[], now: Date): SlotWindow[] {
  return slots.filter((s) => now >= s.windowOpensAt && now < s.kickoff);
}

export interface ReminderCandidate {
  email: string | null;
  emailReminders: boolean;
  hasPick: boolean;
}

/** A user should be reminded iff they opted in, have an email, and haven't picked. */
export function needsReminder(c: ReminderCandidate): boolean {
  return c.emailReminders && !!c.email && !c.hasPick;
}

const SLOT_LABEL: Record<ReminderSlot, string> = {
  THURSDAY: "Thursday night kickoff",
  SUNDAY: "Sunday's games",
  PLAYOFF: "this week's first game",
};

/** Build the reminder email body for a user who still has no pick. */
export function buildReminderEmail(args: {
  displayName: string;
  weekLabel: string;
  slot: ReminderSlot;
  kickoff: Date;
  appUrl: string;
  timeZone?: string;
}): { subject: string; text: string; html: string } {
  const { displayName, weekLabel, slot, kickoff, appUrl } = args;
  const timeZone = args.timeZone ?? DEFAULT_REMINDER_CONFIG.timeZone;
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(kickoff);
  const picksUrl = `${appUrl.replace(/\/$/, "")}/picks`;

  const subject = `Don't forget your ${weekLabel} pick`;
  const text =
    `Hi ${displayName},\n\n` +
    `You haven't made your pick for ${weekLabel} yet. ${SLOT_LABEL[slot]} is at ${when}.\n\n` +
    `Make your pick: ${picksUrl}\n\n` +
    `— GFL Survivor Pool\n\n` +
    `You can turn these reminders off in Settings.`;
  const html =
    `<p>Hi ${displayName},</p>` +
    `<p>You haven't made your pick for <strong>${weekLabel}</strong> yet. ` +
    `${SLOT_LABEL[slot]} is at ${when}.</p>` +
    `<p><a href="${picksUrl}">Make your pick</a></p>` +
    `<p>— GFL Survivor Pool<br>` +
    `<small>You can turn these reminders off in Settings.</small></p>`;

  return { subject, text, html };
}
