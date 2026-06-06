"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getTeamName } from "@/lib/nfl-teams";

interface Game {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  kickoff: string;
}

interface Week {
  id: string;
  weekNumber: number;
  label: string;
  isPlayoff: boolean;
  pointValue: number;
  pickDeadline: string;
  games: Game[];
}

interface Pick {
  id: string;
  weekId: string;
  team: string;
  result: string;
  points: number;
  week: Week;
}

interface Season {
  id: string;
  year: number;
  weeks: Week[];
}

function allStarted(games: Game[]) {
  return games.length > 0 && games.every((g) => new Date() >= new Date(g.kickoff));
}

function resultColor(result: string) {
  if (result === "WIN") return "text-green-400";
  if (result === "LOSS") return "text-red-400";
  return "text-gray-500";
}

export default function PicksPage() {
  const [season, setSeason] = useState<Season | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [usedTeams, setUsedTeams] = useState<string[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<Week | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const weekRef = useRef<string | null>(null);

  const load = useCallback(async (keepWeek = false) => {
    const res = await fetch("/api/picks");
    const data = await res.json();
    setSeason(data.season);
    setPicks(data.picks);
    setUsedTeams(data.usedTeams);

    if (data.season?.weeks) {
      if (keepWeek && weekRef.current) {
        const w = data.season.weeks.find((w: Week) => w.id === weekRef.current);
        if (w) { setSelectedWeek(w); return; }
      }
      const active = data.season.weeks.find((w: Week) => !allStarted(w.games) || w.games.length === 0);
      const w = active ?? data.season.weeks[data.season.weeks.length - 1];
      setSelectedWeek(w);
      weekRef.current = w.id;
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    if (!season) return;
    const hasActive = season.weeks.some((w) =>
      w.games.some((g) => g.status === "LIVE" || (g.status === "SCHEDULED" && new Date() >= new Date(g.kickoff)))
    );
    if (!hasActive) return;
    const interval = setInterval(async () => {
      await fetch("/api/scores/sync", { method: "POST" }).catch(() => {});
      load(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [season, load]);

  async function pick(team: string) {
    if (!selectedWeek) return;
    setSubmitting(true);
    setNotice(null);
    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekId: selectedWeek.id, team }),
    });
    const data = await res.json();
    setNotice(res.ok ? { type: "ok", text: `Picked ${getTeamName(team)}` } : { type: "err", text: data.error });
    if (res.ok) load();
    setSubmitting(false);
  }

  if (!season) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center text-gray-500">
        <p className="text-lg font-medium text-gray-400">No active season</p>
        <p className="mt-1 text-sm">An admin needs to set up the season first.</p>
      </div>
    );
  }

  const totalPoints = picks.reduce((s, p) => s + p.points, 0);
  const currentPick = picks.find((p) => p.weekId === selectedWeek?.id);
  const currentPickGame = selectedWeek?.games.find(
    (g) => g.homeTeam === currentPick?.team || g.awayTeam === currentPick?.team
  );
  const currentPickLocked = currentPick && currentPickGame
    ? new Date() >= new Date(currentPickGame.kickoff)
    : false;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">{season.year} Season</h1>
        <span className="text-sm font-medium text-gray-400">{totalPoints} pts</span>
      </div>

      <select
        value={selectedWeek?.id ?? ""}
        onChange={(e) => {
          const w = season.weeks.find((w) => w.id === e.target.value);
          if (w) { setSelectedWeek(w); weekRef.current = w.id; setNotice(null); }
        }}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
      >
        {season.weeks.map((week) => {
          const p = picks.find((p) => p.weekId === week.id);
          const label = week.isPlayoff ? `${week.label} (${week.pointValue}pt)` : `Week ${week.weekNumber}`;
          const badge = p ? (p.result === "WIN" ? " ✓" : p.result === "LOSS" ? " ✗" : " •") : "";
          return <option key={week.id} value={week.id}>{label}{badge}</option>;
        })}
      </select>

      {selectedWeek && (
        <>
          {/* Current pick summary */}
          {currentPick && (
            <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${
              currentPick.result === "WIN" ? "border-green-700 bg-green-900/20" :
              currentPick.result === "LOSS" ? "border-red-900 bg-red-900/10" :
              "border-white/10 bg-white/5"
            }`}>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Your pick</p>
                <p className="text-base font-semibold mt-0.5">{getTeamName(currentPick.team)}</p>
              </div>
              <span className={`text-sm font-medium ${resultColor(currentPick.result)}`}>
                {currentPick.result === "PENDING"
                  ? (currentPickLocked ? "Locked" : "Pending")
                  : currentPick.result}
                {currentPick.points > 0 && ` · +${currentPick.points}pts`}
              </span>
            </div>
          )}

          {notice && (
            <p className={`text-sm ${notice.type === "ok" ? "text-green-400" : "text-red-400"}`}>
              {notice.text}
            </p>
          )}

          {/* Matchup cards — one per game */}
          {selectedWeek.games.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                {currentPickLocked ? "Matchups" : currentPick ? "Change pick" : "Make your pick"}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {selectedWeek.games.map((game) => {
                  const gameLocked = new Date() >= new Date(game.kickoff);
                  const awayPicked = currentPick?.team === game.awayTeam;
                  const homePicked = currentPick?.team === game.homeTeam;
                  const awayUsed = usedTeams.includes(game.awayTeam) && !awayPicked;
                  const homeUsed = usedTeams.includes(game.homeTeam) && !homePicked;

                  const kickoffStr = new Date(game.kickoff).toLocaleString([], {
                    weekday: "short", month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit",
                  });

                  return (
                    <div key={game.id} className="rounded-xl border border-white/10 overflow-hidden">
                      <div className="flex divide-x divide-white/10">
                        <TeamSide
                          abbr={game.awayTeam}
                          isPicked={awayPicked}
                          isUsed={awayUsed}
                          disabled={submitting || currentPickLocked || gameLocked || awayUsed}
                          onPick={() => pick(game.awayTeam)}
                        />
                        <TeamSide
                          abbr={game.homeTeam}
                          isPicked={homePicked}
                          isUsed={homeUsed}
                          disabled={submitting || currentPickLocked || gameLocked || homeUsed}
                          onPick={() => pick(game.homeTeam)}
                        />
                      </div>
                      {/* Status bar */}
                      <div className="border-t border-white/10 px-3 py-1.5 text-center text-xs">
                        {game.status === "FINAL" ? (
                          <span className="text-gray-500">
                            Final · {game.awayScore}–{game.homeScore}
                          </span>
                        ) : game.status === "LIVE" ? (
                          <span className="text-green-400 flex items-center justify-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            Live · {game.awayScore}–{game.homeScore}
                          </span>
                        ) : (
                          <span className={gameLocked ? "text-yellow-600" : "text-gray-500"}>
                            {gameLocked ? "In progress" : kickoffStr}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-center py-8 text-sm text-gray-600">No games scheduled for this week yet.</p>
          )}

          {/* Season history */}
          <div className="space-y-2">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors uppercase tracking-wider"
            >
              <span className={`transition-transform ${showHistory ? "rotate-90" : ""}`}>▶</span>
              Season picks
            </button>
            {showHistory && (
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="px-4 py-2 text-left text-xs text-gray-500">Week</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500">Pick</th>
                      <th className="px-4 py-2 text-right text-xs text-gray-500">Result</th>
                      <th className="px-4 py-2 text-right text-xs text-gray-500">Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {picks.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-600 text-xs">No picks yet</td></tr>
                    )}
                    {picks.sort((a, b) => a.week.weekNumber - b.week.weekNumber).map((p) => (
                      <tr key={p.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-4 py-2 text-gray-400">{p.week.label}</td>
                        <td className="px-4 py-2">{getTeamName(p.team)}</td>
                        <td className={`px-4 py-2 text-right ${resultColor(p.result)}`}>{p.result}</td>
                        <td className="px-4 py-2 text-right text-gray-400">{p.points || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TeamSide({
  abbr, isPicked, isUsed, disabled, onPick,
}: {
  abbr: string;
  isPicked: boolean;
  isUsed: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onPick}
      className={`flex-1 px-3 py-4 text-center transition-all active:scale-95 ${
        isPicked
          ? "bg-blue-900/40 text-white"
          : disabled
          ? "text-gray-600 cursor-not-allowed"
          : "hover:bg-white/10 text-gray-200"
      }`}
    >
      <div className="font-bold text-sm">{abbr}</div>
      <div className="text-xs mt-1 leading-snug">
        {getTeamName(abbr)}
      </div>
      {isUsed && <div className="mt-1.5 text-xs text-gray-600">Used</div>}
      {isPicked && !isUsed && <div className="mt-1.5 text-xs text-blue-400">✓ Your pick</div>}
    </button>
  );
}
