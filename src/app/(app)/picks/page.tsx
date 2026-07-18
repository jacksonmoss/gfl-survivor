"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { getTeamName, getLogoUrl } from "@/lib/nfl-teams";
import { isIndoorStadium } from "@/lib/stadiums";
import { formatWeather, weatherIcon } from "@/lib/weather";
import type { GameWeather } from "@/lib/weather";
import { formatSpread } from "@/lib/odds";

interface Game {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  kickoff: string;
  weatherJson: GameWeather | null;
  spreadHome: number | null;
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
  const [loading, setLoading] = useState(true);
  const weekRef = useRef<string | null>(null);

  const load = useCallback(async (keepWeek = false) => {
    let data;
    try {
      const res = await fetch("/api/picks");
      data = await res.json();
    } catch {
      // Network/parse error — stop the skeleton and fall through to the
      // "No active season" state rather than spinning forever.
      setLoading(false);
      return;
    }
    setLoading(false);
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
    let cancelled = false;
    (async () => {
      await load();
      // Kick a single sync so weather (and any live scores) populate even
      // before a game has started — the sync route caches weather in the DB,
      // so this stays cheap (ESPN is rate-limited, forecasts refresh ~3h).
      await fetch("/api/scores/sync", { method: "POST" }).catch(() => {});
      if (!cancelled) load(true);
    })();
    return () => { cancelled = true; };
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
    const week = selectedWeek;
    setSubmitting(true);
    setNotice(null);

    // Optimistic update — reflect the pick instantly, then reconcile with the
    // server (or roll back on error). The current-pick card keys off the team,
    // so swapping it remounts and replays the success `animate-pop`.
    const prevPicks = picks;
    const prevUsed = usedTeams;
    const oldTeam = picks.find((p) => p.weekId === week.id)?.team;
    const optimistic: Pick = {
      id: `optimistic-${team}`, weekId: week.id, team,
      result: "PENDING", points: 0, week,
    };
    setPicks((cur) => [...cur.filter((p) => p.weekId !== week.id), optimistic]);
    setUsedTeams((cur) => {
      const withoutOld = oldTeam ? cur.filter((t) => t !== oldTeam) : cur;
      return withoutOld.includes(team) ? withoutOld : [...withoutOld, team];
    });

    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekId: week.id, team }),
    });
    const data = await res.json();
    if (res.ok) {
      setNotice({ type: "ok", text: `Picked ${getTeamName(team)}` });
      load(true);
    } else {
      // Roll back the optimistic update.
      setPicks(prevPicks);
      setUsedTeams(prevUsed);
      setNotice({ type: "err", text: data.error });
    }
    setSubmitting(false);
  }

  if (loading) return <PicksSkeleton />;

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
            <div key={currentPick.team} className={`animate-pop rounded-xl border px-4 py-3 flex items-center justify-between ${
              currentPick.result === "WIN" ? "border-green-700 bg-green-900/20" :
              currentPick.result === "LOSS" ? "border-red-900 bg-red-900/10" :
              "border-white/10 bg-white/5"
            }`}>
              <div className="flex items-center gap-3">
                <TeamLogo abbr={currentPick.team} size={36} />
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Your pick</p>
                  <p className="text-base font-semibold mt-0.5">{getTeamName(currentPick.team)}</p>
                </div>
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
                  const indoor = isIndoorStadium(game.homeTeam);
                  // Hide the forecast once the game is final — the cached
                  // forecast is pre-game and would read as stale/current.
                  const weather = game.status === "FINAL" ? null : game.weatherJson;
                  // Spread is pre-game context — hide it once the game is final.
                  const spreadHome = game.status === "FINAL" ? null : game.spreadHome;
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
                          spread={spreadHome === null ? null : formatSpread(spreadHome, false)}
                          isPicked={awayPicked}
                          isUsed={awayUsed}
                          disabled={submitting || currentPickLocked || gameLocked || awayUsed}
                          onPick={() => pick(game.awayTeam)}
                        />
                        <TeamSide
                          abbr={game.homeTeam}
                          spread={spreadHome === null ? null : formatSpread(spreadHome, true)}
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
                      {/* Weather strip — dome symbol for indoor, forecast for outdoor.
                          Renders nothing outdoors when the forecast isn't cached yet. */}
                      {(indoor || weather) && (
                        <div className="border-t border-white/5 px-3 py-1 text-center text-[11px] text-gray-500">
                          {indoor ? (
                            <span title="Indoor stadium — weather not a factor">🏟️ Dome</span>
                          ) : (
                            <span>{weatherIcon(weather!.code)} {formatWeather(weather!)}</span>
                          )}
                        </div>
                      )}
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

function PicksSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="h-6 w-40 rounded bg-white/10 animate-pulse" />
        <div className="h-5 w-12 rounded bg-white/10 animate-pulse" />
      </div>
      <div className="h-10 w-full rounded-lg bg-white/10 animate-pulse" />
      <div className="h-16 w-full rounded-xl bg-white/10 animate-pulse" />
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-white/10 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function TeamLogo({ abbr, size = 40 }: { abbr: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      src={getLogoUrl(abbr)}
      alt={abbr}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="object-contain"
    />
  );
}

function TeamSide({
  abbr, spread, isPicked, isUsed, disabled, onPick,
}: {
  abbr: string;
  spread: string | null;
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
      <div className="flex justify-center mb-1.5">
        <TeamLogo abbr={abbr} size={40} />
      </div>
      <div className="font-bold text-sm">{abbr}</div>
      <div className="text-xs mt-0.5 leading-snug">
        {getTeamName(abbr)}
      </div>
      {spread !== null && (
        <div className="mt-1 text-[11px] tabular-nums text-gray-500" title="Vegas spread">{spread}</div>
      )}
      {isUsed && <div className="mt-1.5 text-xs text-gray-600">Used</div>}
      {isPicked && !isUsed && <div className="mt-1.5 text-xs text-blue-400">✓ Your pick</div>}
    </button>
  );
}
