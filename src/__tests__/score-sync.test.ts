import { describe, it, expect } from "vitest";
import { computeGameUpdate, computeAllGameUpdates, extractImportableGames } from "@/lib/score-sync";
import type { DbGame } from "@/lib/score-sync";
import type { ESPNResponse } from "@/lib/espn";

import scheduledFixture from "./fixtures/espn-scoreboard-scheduled.json";
import liveFixture from "./fixtures/espn-scoreboard-live.json";
import finalFixture from "./fixtures/espn-scoreboard-final.json";

const makeDbGame = (overrides: Partial<DbGame> & { externalId: string }): DbGame => ({
  id: `game-${overrides.externalId}`,
  homeScore: 0,
  awayScore: 0,
  status: "SCHEDULED",
  ...overrides,
});

describe("computeGameUpdate", () => {
  const event = (finalFixture as ESPNResponse).events[0]; // KC 27 DET 20 FINAL
  const dbGame = makeDbGame({ externalId: "401671801" });

  it("returns null when nothing changed", () => {
    const alreadyFinal = makeDbGame({ externalId: "401671801", homeScore: 27, awayScore: 20, status: "FINAL" });
    expect(computeGameUpdate(event, alreadyFinal)).toBeNull();
  });

  it("detects score change from 0-0 to final score", () => {
    const update = computeGameUpdate(event, dbGame);
    expect(update).not.toBeNull();
    expect(update!.homeScore).toBe(27);
    expect(update!.awayScore).toBe(20);
    expect(update!.status).toBe("FINAL");
  });

  it("sets justFinished=true on SCHEDULED→FINAL transition", () => {
    const update = computeGameUpdate(event, dbGame);
    expect(update!.justFinished).toBe(true);
  });

  it("sets justFinished=true on LIVE→FINAL transition", () => {
    const liveDbGame = makeDbGame({ externalId: "401671801", homeScore: 20, awayScore: 14, status: "LIVE" });
    const update = computeGameUpdate(event, liveDbGame);
    expect(update!.justFinished).toBe(true);
  });

  it("does NOT set justFinished when game was already FINAL", () => {
    const alreadyFinalButScoreChanged = makeDbGame({ externalId: "401671801", homeScore: 24, awayScore: 20, status: "FINAL" });
    const update = computeGameUpdate(event, alreadyFinalButScoreChanged);
    expect(update!.justFinished).toBe(false);
  });

  it("identifies the winning team correctly (home win)", () => {
    const update = computeGameUpdate(event, dbGame)!;
    expect(update.winnerTeam).toBe("KC");
    expect(update.losingTeam).toBe("DET");
  });

  it("identifies the winning team correctly (away win)", () => {
    const awayWinEvent = (finalFixture as ESPNResponse).events[2]; // SF 17 DAL 24 — away wins
    const awayDbGame = makeDbGame({ externalId: "401671803" });
    const update = computeGameUpdate(awayWinEvent, awayDbGame)!;
    expect(update.winnerTeam).toBe("DAL");
    expect(update.losingTeam).toBe("SF");
  });

  it("handles WSH→WAS abbreviation mapping", () => {
    const eventWithWSH: ESPNResponse["events"][0] = {
      id: "401671999",
      competitions: [{
        id: "401671999",
        date: "2025-09-07T17:00:00Z",
        status: { type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true } },
        competitors: [
          { homeAway: "home", team: { abbreviation: "NYG" }, score: "10" },
          { homeAway: "away", team: { abbreviation: "WSH" }, score: "24" },
        ],
      }],
    };
    const game = makeDbGame({ externalId: "401671999" });
    const update = computeGameUpdate(eventWithWSH, game)!;
    expect(update.winnerTeam).toBe("WAS");
    expect(update.losingTeam).toBe("NYG");
  });

  it("maps ESPN LIVE state to LIVE status", () => {
    const liveEvent = (liveFixture as ESPNResponse).events[1]; // BUF 14 MIA 10 in progress
    const game = makeDbGame({ externalId: "401671802" });
    const update = computeGameUpdate(liveEvent, game)!;
    expect(update.status).toBe("LIVE");
    expect(update.justFinished).toBe(false);
    expect(update.winnerTeam).toBeNull();
  });

  it("maps ESPN pre state to SCHEDULED status", () => {
    const scheduledEvent = (scheduledFixture as ESPNResponse).events[0];
    // Simulate a score change on a pre-game event (shouldn't happen normally but handled)
    const game = makeDbGame({ externalId: "401671801", homeScore: 5, awayScore: 0 });
    const update = computeGameUpdate(scheduledEvent, game)!;
    expect(update.status).toBe("SCHEDULED");
  });
});

describe("computeAllGameUpdates", () => {
  it("skips events not in DB game list", () => {
    const dbGames = [makeDbGame({ externalId: "401671801" })];
    const updates = computeAllGameUpdates(finalFixture as ESPNResponse, dbGames);
    expect(updates).toHaveLength(1);
    expect(updates[0].gameId).toBe("game-401671801");
  });

  it("returns no updates when all games already match", () => {
    const dbGames = [
      makeDbGame({ externalId: "401671801", homeScore: 27, awayScore: 20, status: "FINAL" }),
      makeDbGame({ externalId: "401671802", homeScore: 31, awayScore: 10, status: "FINAL" }),
      makeDbGame({ externalId: "401671803", homeScore: 17, awayScore: 24, status: "FINAL" }),
    ];
    const updates = computeAllGameUpdates(finalFixture as ESPNResponse, dbGames);
    expect(updates).toHaveLength(0);
  });

  it("returns updates only for changed games in a mixed live week", () => {
    const dbGames = [
      makeDbGame({ externalId: "401671801" }), // was SCHEDULED, now FINAL → should update
      makeDbGame({ externalId: "401671802", homeScore: 14, awayScore: 10, status: "LIVE" }), // already matches live fixture
      makeDbGame({ externalId: "401671803" }), // was SCHEDULED, still SCHEDULED → no update
    ];
    const updates = computeAllGameUpdates(liveFixture as ESPNResponse, dbGames);
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("FINAL");
    expect(updates[0].justFinished).toBe(true);
  });

  it("prevents double-grading: no justFinished for already-FINAL games", () => {
    const dbGames = [
      makeDbGame({ externalId: "401671801", homeScore: 27, awayScore: 20, status: "FINAL" }),
    ];
    // Simulate ESPN returning the same final result again
    const updates = computeAllGameUpdates(finalFixture as ESPNResponse, dbGames);
    expect(updates).toHaveLength(0); // nothing changed → no update, no grading
  });
});

describe("extractImportableGames", () => {
  it("imports all games when none exist", () => {
    const games = extractImportableGames(scheduledFixture as ESPNResponse, new Set());
    expect(games).toHaveLength(3);
  });

  it("skips games that are already imported", () => {
    const existing = new Set(["401671801", "401671802"]);
    const games = extractImportableGames(scheduledFixture as ESPNResponse, existing);
    expect(games).toHaveLength(1);
    expect(games[0].externalId).toBe("401671803");
  });

  it("skips all games on re-import (dedup)", () => {
    const existing = new Set(["401671801", "401671802", "401671803"]);
    const games = extractImportableGames(scheduledFixture as ESPNResponse, existing);
    expect(games).toHaveLength(0);
  });

  it("sets correct team abbreviations", () => {
    const games = extractImportableGames(scheduledFixture as ESPNResponse, new Set());
    const kc = games.find((g) => g.externalId === "401671801");
    expect(kc!.homeTeam).toBe("KC");
    expect(kc!.awayTeam).toBe("DET");
  });

  it("maps WSH to WAS on import", () => {
    const dataWithWSH: ESPNResponse = {
      events: [{
        id: "401671999",
        competitions: [{
          id: "401671999",
          date: "2025-09-08T17:00:00Z",
          status: { type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false } },
          competitors: [
            { homeAway: "home", team: { abbreviation: "NYG" }, score: "0" },
            { homeAway: "away", team: { abbreviation: "WSH" }, score: "0" },
          ],
        }],
      }],
    };
    const games = extractImportableGames(dataWithWSH, new Set());
    expect(games[0].awayTeam).toBe("WAS");
  });

  it("parses kickoff date correctly", () => {
    const games = extractImportableGames(scheduledFixture as ESPNResponse, new Set());
    expect(games[0].kickoff).toBeInstanceOf(Date);
    expect(games[0].kickoff.toISOString()).toBe("2025-09-07T13:00:00.000Z");
  });
});
