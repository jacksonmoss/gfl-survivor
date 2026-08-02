import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  runSeasonSimulation,
  checkInvariants,
  setupSimDatabase,
  type SimResult,
} from "../../prisma/sim-season";

// DB-backed full-season simulation (#108). Runs the real Prisma schema + real
// grader through a whole 22-week season and asserts the workflow invariants.
//
// Gated on SIM_DATABASE_URL so a normal `pnpm test` (no DB) skips it and never
// touches dev data; CI sets it to a throwaway `gfl_sim`. Run locally with:
//   SIM_DATABASE_URL=postgresql://gfl:gfl_dev_password@localhost:5433/gfl_sim pnpm test sim-season
const SIM_DB_URL = process.env.SIM_DATABASE_URL;

describe.skipIf(!SIM_DB_URL)("full-season simulation (DB-backed)", () => {
  let prisma: PrismaClient;
  let result: SimResult;

  beforeAll(async () => {
    await setupSimDatabase(SIM_DB_URL!);
    prisma = new PrismaClient({ adapter: new PrismaPg(SIM_DB_URL!) });
    result = await runSeasonSimulation(prisma, { seed: 20260725, log: false });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("plays all 22 weeks (18 regular + 4 playoff)", () => {
    expect(result.weeks).toHaveLength(22);
    expect(result.weeks.filter((w) => !w.isPlayoff)).toHaveLength(18);
    expect(result.weeks.filter((w) => w.isPlayoff)).toHaveLength(4);
  });

  it("holds every season invariant (no reuse, escalation, totals, trophy)", () => {
    expect(checkInvariants(result)).toEqual([]);
  });

  it("grades every pick — none left PENDING", () => {
    expect(result.picks.length).toBeGreaterThan(0);
    for (const p of result.picks) {
      expect(["WIN", "LOSS"]).toContain(p.result);
    }
  });

  it("no player reuses a team across the season", () => {
    for (const player of result.players) {
      const teams = result.picks.filter((p) => p.userId === player.id).map((p) => p.team);
      expect(new Set(teams).size, `${player.username} reused a team`).toBe(teams.length);
    }
  });

  it("WIN points follow the escalation table (1 / 2 / 3 / 4 / 5)", () => {
    const pvByWeek = new Map(result.weeks.map((w) => [w.weekNumber, w.pointValue]));
    for (const p of result.picks.filter((x) => x.result === "WIN")) {
      expect(p.points, `week ${p.weekNumber} win`).toBe(pvByWeek.get(p.weekNumber));
    }
    // Every playoff round produced a graded win, so 2/3/4/5 were all exercised.
    for (const wk of [19, 20, 21, 22]) {
      expect(result.picks.some((p) => p.weekNumber === wk && p.result === "WIN"), `week ${wk} win`).toBe(true);
    }
  });

  it("each player's leaderboard total equals the sum of their graded points", () => {
    const pvByWeek = new Map(result.weeks.map((w) => [w.weekNumber, w.pointValue]));
    for (const player of result.players) {
      const pp = result.picks.filter((p) => p.userId === player.id);
      const total = pp.reduce((s, p) => s + p.points, 0);
      const expected = pp
        .filter((p) => p.result === "WIN")
        .reduce((s, p) => s + pvByWeek.get(p.weekNumber)!, 0);
      expect(total).toBe(expected);
    }
  });

  it("computes a team-trophy avg win% in [0,1] for each trophy team", () => {
    expect(result.trophy.length).toBeGreaterThan(0);
    for (const t of result.trophy) {
      expect(t.avgWinPct).toBeGreaterThanOrEqual(0);
      expect(t.avgWinPct).toBeLessThanOrEqual(1);
    }
  });
});
