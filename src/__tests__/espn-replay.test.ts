import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { computeAllGameUpdates, computeGameUpdate } from "@/lib/score-sync";
import type { DbGame } from "@/lib/score-sync";
import { getESPNWeekParams, mapTeamAbbr } from "@/lib/espn";
import type { ESPNResponse, ESPNEvent } from "@/lib/espn";
import { NFL_TEAMS } from "@/lib/nfl-teams";

// ESPN fixture replay (#109) — part B of the season dry-run plan (#108 is part A).
//
// Replays a real completed season's ESPN scoreboard JSON (recorded by
// scripts/record-espn-season.ts) through the *actual* parser + grader
// (computeAllGameUpdates), so the regular→playoff transition, the SB week=5
// quirk, and team-abbr edge cases (ESPN "WSH" → our "WAS") break offline in
// July, not live in January. No network: fixtures only.

const YEAR = 2024;
const FIXTURE_DIR = join(__dirname, "..", "..", "fixtures", "espn");
const VALID_ABBRS = new Set(NFL_TEAMS.map((t) => t.abbr));

function loadFixture(seasonType: number, espnWeek: number): ESPNResponse {
  const file = join(FIXTURE_DIR, `${YEAR}-${seasonType}-${espnWeek}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as ESPNResponse;
}

// Our internal week 1-22 → the ESPN (seasonType, espnWeek) it maps to.
const ALL_WEEKS = Array.from({ length: 22 }, (_, i) => i + 1).map((weekNumber) => ({
  weekNumber,
  isPlayoff: weekNumber >= 19,
  ...getESPNWeekParams(weekNumber, weekNumber >= 19),
}));

/** Build SCHEDULED (0-0) DB games for every event so a FINAL fixture grades. */
function scheduledGamesFor(data: ESPNResponse): DbGame[] {
  return data.events.map((e) => ({
    id: `db-${e.id}`,
    externalId: e.id,
    homeScore: 0,
    awayScore: 0,
    status: "SCHEDULED" as const,
  }));
}

/** ESPN's own recorded winner for an event (the competitor flagged winner=true). */
function espnWinnerAbbr(event: ESPNEvent): string | null {
  const comp = event.competitions[0];
  const w = comp.competitors.find((c) => c.winner);
  return w ? w.team.abbreviation : null;
}

describe("ESPN fixture replay (2024 full season)", () => {
  it("has a fixture for every regular week + all four playoff rounds", () => {
    // 18 regular + 4 playoff, no gaps — proves the recorder covered the season.
    expect(ALL_WEEKS).toHaveLength(22);
    for (const w of ALL_WEEKS) {
      expect(() => loadFixture(w.seasonType, w.espnWeek)).not.toThrow();
    }
  });

  it("maps the regular→playoff transition and playoff rounds correctly", () => {
    // Week 18 is the last regular week (seasonType 2); week 19 flips to the
    // playoffs (seasonType 3, espnWeek 1) and week 22 jumps to espnWeek 5 —
    // ESPN's Pro-Bowl-skips-4 quirk. These are the breaks most likely to bite.
    expect(getESPNWeekParams(18, false)).toEqual({ seasonType: 2, espnWeek: 18 });
    expect(getESPNWeekParams(19, true)).toEqual({ seasonType: 3, espnWeek: 1 });
    expect(getESPNWeekParams(20, true)).toEqual({ seasonType: 3, espnWeek: 2 });
    expect(getESPNWeekParams(21, true)).toEqual({ seasonType: 3, espnWeek: 3 });
    expect(getESPNWeekParams(22, true)).toEqual({ seasonType: 3, espnWeek: 5 });

    // The playoff fixtures shrink each round (6→4→2→1), confirming the mapped
    // files are the right rounds, not just parseable.
    expect(loadFixture(3, 1).events).toHaveLength(6); // Wild Card
    expect(loadFixture(3, 2).events).toHaveLength(4); // Divisional
    expect(loadFixture(3, 3).events).toHaveLength(2); // Conference
    expect(loadFixture(3, 5).events).toHaveLength(1); // Super Bowl
  });

  // Per-week: every fixture parses, every FINAL game grades, and the grader's
  // score-derived winner matches ESPN's own winner flag (mapped WSH→WAS).
  for (const w of ALL_WEEKS) {
    const label = w.isPlayoff ? `playoff round ${w.espnWeek} (week ${w.weekNumber})` : `week ${w.weekNumber}`;
    it(`grades ${label} the same way ESPN did`, () => {
      const data = loadFixture(w.seasonType, w.espnWeek);
      expect(data.events.length).toBeGreaterThan(0);

      const updates = computeAllGameUpdates(data, scheduledGamesFor(data));
      // Every completed game produces exactly one FINAL transition.
      expect(updates).toHaveLength(data.events.length);

      const byExternal = new Map(data.events.map((e) => [e.id, e]));
      for (const u of updates) {
        expect(u.status).toBe("FINAL");
        expect(u.justFinished).toBe(true);
        expect(u.winnerTeam).not.toBeNull();
        expect(u.losingTeam).not.toBeNull();
        // Winner/loser resolve to our canonical 32-team abbreviations.
        expect(VALID_ABBRS.has(u.winnerTeam!)).toBe(true);
        expect(VALID_ABBRS.has(u.losingTeam!)).toBe(true);

        // Grade matches ESPN's recorded result. espnWinnerAbbr is ESPN's raw
        // abbr (e.g. "WSH"); our winnerTeam is that mapped through our table
        // ("WAS"), so map the expected side the same way before comparing.
        const espnRaw = espnWinnerAbbr(byExternal.get(u.gameId.replace(/^db-/, ""))!);
        expect(espnRaw).not.toBeNull();
        expect(u.winnerTeam).toBe(mapTeamAbbr(espnRaw!));
      }
    });
  }

  it("resolves ESPN 'WSH' to 'WAS' in a real graded game (Commanders 42-19 over Titans)", () => {
    // Regular week 13 fixture, event 401671743: WSH beat TEN. The grade must
    // come out as our "WAS", not ESPN's "WSH" — the one abbr edge case that bites.
    const data = loadFixture(2, 13);
    const event = data.events.find((e) => e.id === "401671743");
    expect(event).toBeDefined();

    const update = computeGameUpdate(event!, {
      id: "db-401671743",
      externalId: "401671743",
      homeScore: 0,
      awayScore: 0,
      status: "SCHEDULED",
    });
    expect(update?.winnerTeam).toBe("WAS");
    expect(update?.losingTeam).toBe("TEN");
  });

  it("grades the Super Bowl as Eagles over Chiefs (known 2024 result)", () => {
    // Super Bowl LIX: PHI 40, KC 22 — a fixed, known outcome to pin the SB path.
    const data = loadFixture(3, 5);
    expect(data.events).toHaveLength(1);
    const [update] = computeAllGameUpdates(data, scheduledGamesFor(data));
    expect(update.winnerTeam).toBe("PHI");
    expect(update.losingTeam).toBe("KC");
  });

  it("pins the tie behavior: the AWAY team is recorded as the winner (known TODO)", () => {
    // The NFL regular season can tie. No 2024 fixture ties, so pin the current
    // behavior with a synthetic FINAL event to lock it against silent drift.
    //
    // NOTE: the grader uses `homeScore > awayScore ? home : away` — a *strict*
    // comparison, so on an equal score the tie falls to the away branch and the
    // AWAY team is graded the winner. This contradicts the "picks the home team"
    // wording in AGENTS.md's Tie-handling TODO; the code, pinned here, is the
    // source of truth. Tie handling is still an open TODO — this test documents
    // what actually happens today rather than what the doc claimed.
    const tie: ESPNEvent = {
      id: "tie-1",
      competitions: [
        {
          id: "tie-1",
          date: "2024-11-10T18:00Z",
          competitors: [
            { homeAway: "home", team: { abbreviation: "NYG" }, score: "20" },
            { homeAway: "away", team: { abbreviation: "WSH" }, score: "20" },
          ],
          status: { type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true } },
        },
      ],
    };
    const update = computeGameUpdate(tie, {
      id: "db-tie-1",
      externalId: "tie-1",
      homeScore: 0,
      awayScore: 0,
      status: "SCHEDULED",
    });
    // Away (WSH→WAS) is graded the winner on a tie; home (NYG) is the loser.
    expect(update?.winnerTeam).toBe("WAS");
    expect(update?.losingTeam).toBe("NYG");
  });
});
