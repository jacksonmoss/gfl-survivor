import { describe, it, expect } from "vitest";
import { formatKickoff } from "@/lib/datetime";

// An absolute UTC instant: 2025-09-07T17:00:00Z == 1:00 PM EDT == 10:00 AM PDT.
const KICKOFF = new Date("2025-09-07T17:00:00Z");

describe("formatKickoff", () => {
  it("renders date + time with a timezone label in the given zone", () => {
    const et = formatKickoff(KICKOFF, { timeZone: "America/New_York", locale: "en-US" });
    expect(et).toBe("Sun, Sep 7, 1:00 PM EDT");
  });

  it("renders the same instant in a different zone with that zone's label", () => {
    const pt = formatKickoff(KICKOFF, { timeZone: "America/Los_Angeles", locale: "en-US" });
    expect(pt).toBe("Sun, Sep 7, 10:00 AM PDT");
  });

  it("accepts an ISO string (as the picks API delivers kickoff)", () => {
    const fromString = formatKickoff("2025-09-07T17:00:00Z", { timeZone: "America/New_York", locale: "en-US" });
    expect(fromString).toBe("Sun, Sep 7, 1:00 PM EDT");
  });

  it("always includes a timezone label", () => {
    // Whatever the runtime default zone is, the output must carry a zone token
    // so the viewer is never left guessing (the core of #90).
    const out = formatKickoff(KICKOFF, { locale: "en-US" });
    expect(out).toMatch(/\b(?:[A-Z]{2,5}|GMT[+-]\d{1,2})\b$/);
  });
});
