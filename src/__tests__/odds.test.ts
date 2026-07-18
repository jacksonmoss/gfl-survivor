import { describe, it, expect } from "vitest";
import {
  buildOddsApiUrl,
  median,
  parseSpreadForGame,
  gameNeedsOdds,
  oddsRefreshDue,
  formatSpread,
  ODDS_LOOKAHEAD_MS,
  ODDS_REFRESH_MS,
  type OddsEvent,
} from "@/lib/odds";

describe("buildOddsApiUrl", () => {
  it("requests US spreads with the given key", () => {
    const url = buildOddsApiUrl("secret-key");
    expect(url).toContain("americanfootball_nfl/odds");
    expect(url).toContain("apiKey=secret-key");
    expect(url).toContain("regions=us");
    expect(url).toContain("markets=spreads");
  });
});

describe("median", () => {
  it("returns the middle value for odd-length lists", () => {
    expect(median([-3, -6.5, -1])).toBe(-3);
  });

  it("averages the two middle values for even-length lists", () => {
    expect(median([-6.5, -7, -6, -7.5])).toBe(-6.75);
  });

  it("does not mutate the input", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("parseSpreadForGame", () => {
  const events: OddsEvent[] = [
    {
      home_team: "Kansas City Chiefs",
      away_team: "Buffalo Bills",
      bookmakers: [
        { key: "draftkings", markets: [{ key: "spreads", outcomes: [
          { name: "Kansas City Chiefs", point: -6.5 },
          { name: "Buffalo Bills", point: 6.5 },
        ] }] },
        { key: "fanduel", markets: [{ key: "spreads", outcomes: [
          { name: "Kansas City Chiefs", point: -7.5 },
          { name: "Buffalo Bills", point: 7.5 },
        ] }] },
      ],
    },
  ];

  it("returns the median home spread across bookmakers", () => {
    expect(parseSpreadForGame(events, "Kansas City Chiefs", "Buffalo Bills")).toBe(-7);
  });

  it("matches regardless of home/away argument order", () => {
    // Passing our home as the feed's away still reads the outcome named homeTeam.
    expect(parseSpreadForGame(events, "Buffalo Bills", "Kansas City Chiefs")).toBe(7);
  });

  it("returns null when the game is not in the feed", () => {
    expect(parseSpreadForGame(events, "Dallas Cowboys", "Philadelphia Eagles")).toBeNull();
  });

  it("returns null when no bookmaker priced the spread", () => {
    const noSpreads: OddsEvent[] = [
      { home_team: "Kansas City Chiefs", away_team: "Buffalo Bills", bookmakers: [
        { key: "dk", markets: [{ key: "h2h", outcomes: [{ name: "Kansas City Chiefs", point: -6.5 }] }] },
      ] },
    ];
    expect(parseSpreadForGame(noSpreads, "Kansas City Chiefs", "Buffalo Bills")).toBeNull();
  });

  it("returns null for missing/invalid input", () => {
    expect(parseSpreadForGame(null, "A", "B")).toBeNull();
    expect(parseSpreadForGame(undefined, "A", "B")).toBeNull();
    expect(parseSpreadForGame([], "A", "B")).toBeNull();
  });
});

describe("gameNeedsOdds", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +1 day

  it("prices an upcoming game within the window", () => {
    expect(gameNeedsOdds({ status: "SCHEDULED", kickoff: soon }, now)).toBe(true);
  });

  it("skips finished games", () => {
    expect(gameNeedsOdds({ status: "FINAL", kickoff: soon }, now)).toBe(false);
  });

  it("skips games that already started", () => {
    const past = new Date(now.getTime() - 60 * 1000);
    expect(gameNeedsOdds({ status: "SCHEDULED", kickoff: past }, now)).toBe(false);
  });

  it("skips games beyond the lookahead window", () => {
    const far = new Date(now.getTime() + ODDS_LOOKAHEAD_MS + 60 * 60 * 1000);
    expect(gameNeedsOdds({ status: "SCHEDULED", kickoff: far }, now)).toBe(false);
  });
});

describe("oddsRefreshDue", () => {
  const now = new Date("2026-09-14T12:00:00Z");

  it("is due when never fetched", () => {
    expect(oddsRefreshDue(null, now)).toBe(true);
  });

  it("is not due within the refresh interval", () => {
    const recent = now.getTime() - ODDS_REFRESH_MS + 60 * 1000;
    expect(oddsRefreshDue(recent, now)).toBe(false);
  });

  it("is due once the refresh interval has elapsed", () => {
    const old = now.getTime() - ODDS_REFRESH_MS - 60 * 1000;
    expect(oddsRefreshDue(old, now)).toBe(true);
  });
});

describe("formatSpread", () => {
  it("shows the favorite with a minus and the underdog with a plus", () => {
    expect(formatSpread(-6.5, true)).toBe("-6.5"); // home favored
    expect(formatSpread(-6.5, false)).toBe("+6.5"); // away is the dog
  });

  it("flips sign for the away side", () => {
    expect(formatSpread(3, true)).toBe("+3"); // home underdog
    expect(formatSpread(3, false)).toBe("-3"); // away favored
  });

  it("shows PK for a pick'em", () => {
    expect(formatSpread(0, true)).toBe("PK");
    expect(formatSpread(0, false)).toBe("PK");
  });
});
