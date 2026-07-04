import { describe, it, expect } from "vitest";
import {
  zonedWeekday,
  zonedMorningOf,
  computeReminderSlots,
  dueSlots,
  needsReminder,
  buildReminderEmail,
  DEFAULT_REMINDER_CONFIG,
} from "@/lib/reminders";

const TZ = DEFAULT_REMINDER_CONFIG.timeZone; // America/New_York

describe("zonedWeekday", () => {
  it("classifies a Thursday-night kickoff as Thursday, not Friday", () => {
    // TNF ~8:15pm ET on Thu Sep 4 2025 == 00:15 UTC Fri Sep 5.
    const tnf = new Date("2025-09-05T00:15:00Z");
    expect(tnf.getUTCDay()).toBe(5); // naive UTC would say Friday
    expect(zonedWeekday(tnf, TZ)).toBe(4); // ET says Thursday
  });

  it("classifies a Sunday 1pm ET kickoff as Sunday", () => {
    const sun = new Date("2025-09-07T17:00:00Z"); // 1pm ET Sun
    expect(zonedWeekday(sun, TZ)).toBe(0);
  });
});

describe("zonedMorningOf", () => {
  it("anchors to 9am ET on the game's calendar day (EST offset)", () => {
    // Wild Card Saturday, Jan 11 2025, 4:30pm ET kickoff.
    const kickoff = new Date("2025-01-11T21:30:00Z");
    const morning = zonedMorningOf(kickoff, 9, TZ);
    // 9am EST (-5) == 14:00 UTC same day.
    expect(morning.toISOString()).toBe("2025-01-11T14:00:00.000Z");
  });
});

describe("computeReminderSlots — regular season", () => {
  const config = DEFAULT_REMINDER_CONFIG;
  const games = [
    { kickoff: new Date("2025-09-05T00:15:00Z") }, // Thu night
    { kickoff: new Date("2025-09-07T17:00:00Z") }, // Sun 1pm ET
    { kickoff: new Date("2025-09-07T20:25:00Z") }, // Sun late
    { kickoff: new Date("2025-09-09T00:15:00Z") }, // Mon night
  ];

  it("produces a Thursday and a Sunday slot", () => {
    const slots = computeReminderSlots(games, false, config);
    expect(slots.map((s) => s.slot)).toEqual(["THURSDAY", "SUNDAY"]);
  });

  it("opens each window regularLeadHours before its kickoff", () => {
    const slots = computeReminderSlots(games, false, config);
    const thu = slots.find((s) => s.slot === "THURSDAY")!;
    const sun = slots.find((s) => s.slot === "SUNDAY")!;
    expect(thu.windowOpensAt.toISOString()).toBe("2025-09-04T21:15:00.000Z");
    // earliest Sunday game (1pm ET), not the late one
    expect(sun.kickoff.toISOString()).toBe("2025-09-07T17:00:00.000Z");
    expect(sun.windowOpensAt.toISOString()).toBe("2025-09-07T14:00:00.000Z");
  });

  it("skips the Thursday slot when there's no Thursday game", () => {
    const noThu = [
      { kickoff: new Date("2025-09-07T17:00:00Z") },
      { kickoff: new Date("2025-09-09T00:15:00Z") },
    ];
    const slots = computeReminderSlots(noThu, false, config);
    expect(slots.map((s) => s.slot)).toEqual(["SUNDAY"]);
  });

  it("returns no slots for a week with no games", () => {
    expect(computeReminderSlots([], false, config)).toEqual([]);
  });
});

describe("computeReminderSlots — playoffs", () => {
  it("produces a single morning-of slot for the earliest game", () => {
    const games = [
      { kickoff: new Date("2025-01-12T18:00:00Z") }, // Sun 1pm ET
      { kickoff: new Date("2025-01-11T21:30:00Z") }, // Sat 4:30pm ET — earliest
    ];
    const slots = computeReminderSlots(games, true, DEFAULT_REMINDER_CONFIG);
    expect(slots).toHaveLength(1);
    expect(slots[0].slot).toBe("PLAYOFF");
    expect(slots[0].kickoff.toISOString()).toBe("2025-01-11T21:30:00.000Z");
    expect(slots[0].windowOpensAt.toISOString()).toBe("2025-01-11T14:00:00.000Z");
  });
});

describe("dueSlots", () => {
  const slots = computeReminderSlots(
    [
      { kickoff: new Date("2025-09-05T00:15:00Z") }, // Thu
      { kickoff: new Date("2025-09-07T17:00:00Z") }, // Sun
    ],
    false
  );

  it("is empty before any window opens", () => {
    expect(dueSlots(slots, new Date("2025-09-04T12:00:00Z"))).toEqual([]);
  });

  it("returns only the Thursday slot inside its window", () => {
    const now = new Date("2025-09-04T22:00:00Z"); // after Thu window opens, before kickoff
    expect(dueSlots(slots, now).map((s) => s.slot)).toEqual(["THURSDAY"]);
  });

  it("drops the Thursday slot once its game has kicked off", () => {
    const now = new Date("2025-09-05T01:00:00Z"); // after Thu kickoff, before Sun window
    expect(dueSlots(slots, now)).toEqual([]);
  });

  it("returns the Sunday slot inside its window", () => {
    const now = new Date("2025-09-07T15:00:00Z");
    expect(dueSlots(slots, now).map((s) => s.slot)).toEqual(["SUNDAY"]);
  });
});

describe("needsReminder", () => {
  it("reminds an opted-in user with an email and no pick", () => {
    expect(needsReminder({ email: "a@b.com", emailReminders: true, hasPick: false })).toBe(true);
  });

  it("skips users who already picked", () => {
    expect(needsReminder({ email: "a@b.com", emailReminders: true, hasPick: true })).toBe(false);
  });

  it("skips opted-out users", () => {
    expect(needsReminder({ email: "a@b.com", emailReminders: false, hasPick: false })).toBe(false);
  });

  it("skips users with no email", () => {
    expect(needsReminder({ email: null, emailReminders: true, hasPick: false })).toBe(false);
  });
});

describe("buildReminderEmail", () => {
  it("includes the week label, a picks link, and an opt-out mention", () => {
    const { subject, text, html } = buildReminderEmail({
      displayName: "jdog",
      weekLabel: "Week 1",
      slot: "SUNDAY",
      kickoff: new Date("2025-09-07T17:00:00Z"),
      appUrl: "https://gfl.example.com/",
    });
    expect(subject).toContain("Week 1");
    expect(text).toContain("https://gfl.example.com/picks");
    expect(text.toLowerCase()).toContain("reminders off");
    expect(html).toContain("https://gfl.example.com/picks");
  });
});
