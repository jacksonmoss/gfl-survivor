import { describe, it, expect } from "vitest";

interface Game {
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
}

// Mirrors the logic in picks/page.tsx
function isTeamLocked(team: string, games: Game[], now: Date): boolean {
  const game = games.find((g) => g.homeTeam === team || g.awayTeam === team);
  if (!game) return true;
  return now >= game.kickoff;
}

// Mirrors the visibility logic in leaderboard/route.ts
function isPickVisible(
  pickTeam: string,
  games: Game[],
  isOwnPick: boolean,
  isAdmin: boolean,
  now: Date
): boolean {
  if (isAdmin || isOwnPick) return true;
  const game = games.find(
    (g) => g.homeTeam === pickTeam || g.awayTeam === pickTeam
  );
  return game ? now >= game.kickoff : false;
}

// Mirrors the grading logic in scores/sync/route.ts
function gradePickResult(
  pickTeam: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number
): "WIN" | "LOSS" {
  const winner = homeScore > awayScore ? homeTeam : awayTeam;
  return pickTeam === winner ? "WIN" : "LOSS";
}

const makeGame = (
  home: string,
  away: string,
  kickoff: Date,
  status = "SCHEDULED",
  homeScore: number | null = null,
  awayScore: number | null = null
): Game => ({
  homeTeam: home,
  awayTeam: away,
  kickoff,
  status,
  homeScore,
  awayScore,
});

describe("isTeamLocked", () => {
  const noon = new Date("2025-09-07T12:00:00Z");
  const games = [
    makeGame("KC", "DET", new Date("2025-09-07T13:00:00Z")),
    makeGame("BUF", "MIA", new Date("2025-09-07T17:00:00Z")),
  ];

  it("locks team after kickoff", () => {
    const afterKC = new Date("2025-09-07T13:01:00Z");
    expect(isTeamLocked("KC", games, afterKC)).toBe(true);
    expect(isTeamLocked("DET", games, afterKC)).toBe(true);
  });

  it("does not lock team before kickoff", () => {
    expect(isTeamLocked("KC", games, noon)).toBe(false);
    expect(isTeamLocked("BUF", games, noon)).toBe(false);
  });

  it("allows late game picks even after early game kicks off", () => {
    const afterFirstGame = new Date("2025-09-07T14:00:00Z");
    expect(isTeamLocked("KC", games, afterFirstGame)).toBe(true);
    expect(isTeamLocked("BUF", games, afterFirstGame)).toBe(false);
  });

  it("locks team not playing this week", () => {
    expect(isTeamLocked("LAR", games, noon)).toBe(true);
  });
});

describe("isPickVisible", () => {
  const games = [
    makeGame("KC", "DET", new Date("2025-09-07T13:00:00Z")),
    makeGame("BUF", "MIA", new Date("2025-09-07T17:00:00Z")),
  ];
  const beforeKickoff = new Date("2025-09-07T12:00:00Z");
  const afterKCKickoff = new Date("2025-09-07T13:30:00Z");

  it("always shows own picks", () => {
    expect(isPickVisible("KC", games, true, false, beforeKickoff)).toBe(true);
  });

  it("always shows picks to admins", () => {
    expect(isPickVisible("KC", games, false, true, beforeKickoff)).toBe(true);
  });

  it("hides other users' picks before kickoff", () => {
    expect(isPickVisible("KC", games, false, false, beforeKickoff)).toBe(false);
    expect(isPickVisible("BUF", games, false, false, beforeKickoff)).toBe(false);
  });

  it("shows other users' picks after their game kicks off", () => {
    expect(isPickVisible("KC", games, false, false, afterKCKickoff)).toBe(true);
  });

  it("still hides later-game picks when early game has started", () => {
    expect(isPickVisible("BUF", games, false, false, afterKCKickoff)).toBe(false);
  });
});

describe("gradePickResult", () => {
  it("grades WIN when picked team wins", () => {
    expect(gradePickResult("KC", "KC", "DET", 27, 20)).toBe("WIN");
    expect(gradePickResult("DET", "KC", "DET", 20, 27)).toBe("WIN");
  });

  it("grades LOSS when picked team loses", () => {
    expect(gradePickResult("KC", "KC", "DET", 20, 27)).toBe("LOSS");
    expect(gradePickResult("DET", "KC", "DET", 27, 20)).toBe("LOSS");
  });

  it("grades away team WIN for away pick on away win", () => {
    expect(gradePickResult("BUF", "MIA", "BUF", 10, 24)).toBe("WIN");
  });
});

describe("playoff point values", () => {
  const pointValues: Record<number, number> = {
    1: 1, 2: 1, 18: 1,  // regular season
    19: 2,                // Wild Card
    20: 3,                // Divisional
    21: 4,                // Conference
    22: 5,                // Super Bowl
  };

  it("regular season weeks are worth 1 point", () => {
    for (let w = 1; w <= 18; w++) {
      expect(pointValues[w] ?? 1).toBe(1);
    }
  });

  it("playoff points escalate correctly", () => {
    expect(pointValues[19]).toBe(2);
    expect(pointValues[20]).toBe(3);
    expect(pointValues[21]).toBe(4);
    expect(pointValues[22]).toBe(5);
  });
});
