import "dotenv/config";
import { writeFileSync } from "fs";
import { join } from "path";
import { buildESPNUrl, getESPNWeekParams } from "../src/lib/espn";

// One-off recorder for the ESPN fixture replay (#109). Pulls a *completed*
// season's scoreboard JSON — regular weeks 1-18 + all four playoff rounds — and
// writes one fixture per (year, seasonType, espnWeek) to fixtures/espn/. The
// replay test (src/__tests__/espn-replay.test.ts) then drives the real parser +
// grader over these payloads, so the regular→playoff transition, team-abbr edge
// cases (WSH→WAS), and playoff feed quirks surface offline in July, not January.
//
// Filenames match exactly what the sync route would request (buildESPNUrl /
// getESPNWeekParams), so a fixture name maps 1:1 to a real ESPN query.
//
// Run manually against a finished season (default 2024):
//   pnpm tsx scripts/record-espn-season.ts          # 2024
//   YEAR=2023 pnpm tsx scripts/record-espn-season.ts
//
// Not part of CI — fixtures are committed; this only regenerates them.

const YEAR = process.env.YEAR ? Number(process.env.YEAR) : 2024;
const FIXTURE_DIR = join(__dirname, "..", "fixtures", "espn");

// Our internal week numbers: 1-18 regular, 19-22 playoffs (WC/Div/Conf/SB).
const WEEK_NUMBERS = Array.from({ length: 22 }, (_, i) => i + 1);

// Raw ESPN scoreboard payloads are ~140KB/week (odds, leaders, venue, broadcast
// blocks the parser never reads). We project down to exactly the fields the
// parser navigates — plus each team's displayName, for cross-checking abbr
// mapping and readable diffs — copying values verbatim so real quirks (missing
// score, tie with no winner flag, etc.) survive. ~10x smaller, same parse path.
interface RawTeam {
  abbreviation: string;
  displayName?: string;
}
interface RawCompetitor {
  homeAway: "home" | "away";
  team: RawTeam;
  score: string;
  winner?: boolean;
}
interface RawCompetition {
  id: string;
  date: string;
  status: { type: { id: string; name: string; state: string; completed: boolean } };
  competitors: RawCompetitor[];
}
interface RawEvent {
  id: string;
  competitions: RawCompetition[];
}
interface RawScoreboard {
  events: RawEvent[];
}

function project(data: RawScoreboard): RawScoreboard {
  return {
    events: (data.events ?? []).map((e) => ({
      id: e.id,
      competitions: (e.competitions ?? []).map((c) => ({
        id: c.id,
        date: c.date,
        status: {
          type: {
            id: c.status.type.id,
            name: c.status.type.name,
            state: c.status.type.state,
            completed: c.status.type.completed,
          },
        },
        competitors: (c.competitors ?? []).map((comp) => ({
          homeAway: comp.homeAway,
          team: { abbreviation: comp.team.abbreviation, displayName: comp.team.displayName },
          score: comp.score,
          winner: comp.winner,
        })),
      })),
    })),
  };
}

async function fetchScoreboard(year: number, seasonType: number, espnWeek: number): Promise<RawScoreboard> {
  const url = buildESPNUrl(year, seasonType, espnWeek);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return project((await res.json()) as RawScoreboard);
}

async function main(): Promise<void> {
  console.log(`Recording ESPN fixtures for ${YEAR} → ${FIXTURE_DIR}`);

  for (const weekNumber of WEEK_NUMBERS) {
    const isPlayoff = weekNumber >= 19;
    const { seasonType, espnWeek } = getESPNWeekParams(weekNumber, isPlayoff, 19);
    const data = await fetchScoreboard(YEAR, seasonType, espnWeek);
    const file = join(FIXTURE_DIR, `${YEAR}-${seasonType}-${espnWeek}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    const count = data.events.length;
    console.log(`  wk ${String(weekNumber).padStart(2)} → ${YEAR}-${seasonType}-${espnWeek}.json (${count} games)`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
