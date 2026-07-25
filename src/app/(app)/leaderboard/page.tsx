"use client";

import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { focusRing } from "@/lib/ui";

const SHOW_PICKS_KEY = "leaderboard:showPicks";

// Persist the picks toggle in localStorage so it survives navigating away and back
// within the session. useSyncExternalStore keeps SSR (false) and client in sync without
// a hydration mismatch and without calling setState in an effect.
function usePersistedToggle(key: string): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      return () => window.removeEventListener("storage", onChange);
    },
    // Accessing localStorage can throw (e.g. Safari "block all cookies", sandboxed
    // iframes). getSnapshot runs during render, so a throw here would crash the page —
    // degrade to the default instead.
    () => {
      try {
        return localStorage.getItem(key) === "true";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const setValue = (next: boolean) => {
    try {
      localStorage.setItem(key, String(next));
      // The native "storage" event only fires in other tabs; dispatch it here so this
      // tab's subscriber re-reads the new value.
      window.dispatchEvent(new StorageEvent("storage", { key }));
    } catch {
      // Storage unavailable — toggle just won't persist across navigation.
    }
  };
  return [value, setValue];
}

interface PlayerStanding {
  id: string;
  displayName: string;
  realName: string | null;
  username: string;
  teamName: string | null;
  points: number;
  wins: number;
  losses: number;
  totalPicks: number;
  winPct: number;
  picks: { week: number; label: string; team: string; result: string; points: number }[];
}

interface TeamStanding {
  name: string;
  playerCount: number;
  avgWinPct: number;
  totalPoints: number;
  players: { displayName: string; points: number; winPct: number }[];
}

interface SeasonOption { id: string; year: number; isActive: boolean }

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<PlayerStanding[]>([]);
  const [teams, setTeams] = useState<TeamStanding[]>([]);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [tab, setTab] = useState<"players" | "teams">("players");
  const [showPicks, setShowPicks] = usePersistedToggle(SHOW_PICKS_KEY);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load(id?: string) {
    const url = id ? `/api/leaderboard?seasonId=${id}` : "/api/leaderboard";
    fetch(url).then((r) => r.json()).then((data) => {
      setLoading(false);
      setPlayers(data.players ?? []);
      setTeams(data.teams ?? []);
      setSeasons(data.seasons ?? []);
      if (data.season) setSeasonId(data.season.id);
    }).catch(() => {
      // Network/parse error — stop the skeleton and fall through to the empty
      // "No players yet" state rather than spinning forever.
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  function onSeasonChange(id: string) {
    setSeasonId(id);
    setExpandedPlayer(null);
    load(id);
  }

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
        <div className="flex items-center gap-2">
          {seasons.length > 0 && (
            <select
              aria-label="Select season"
              value={seasonId}
              onChange={(e) => onSeasonChange(e.target.value)}
              className={`rounded-lg border border-white/10 bg-gray-900 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none ${focusRing}`}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>{s.year}{s.isActive ? " (current)" : ""}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Tab bar + picks toggle */}
      <div className="flex items-center justify-between border-b border-white/10">
        <div role="tablist" aria-label="Leaderboard view" className="flex gap-1">
          {(["players", "teams"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const next = t === "players" ? "teams" : "players";
                  setTab(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2 capitalize ${focusRing} ${
                tab === t ? "border-blue-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "teams" ? "Team Trophy" : "Players"}
            </button>
          ))}
        </div>
        {tab === "players" && (
          <button
            onClick={() => setShowPicks(!showPicks)}
            aria-pressed={showPicks}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-all mb-1 ${focusRing} ${
              showPicks
                ? "border-blue-500 bg-blue-900/30 text-blue-300"
                : "border-white/10 text-gray-500 hover:text-gray-300"
            }`}
          >
            {showPicks ? "Hide Picks" : "Show Picks"}
          </button>
        )}
      </div>

      {loading && <LeaderboardSkeleton />}

      {/* Players tab */}
      {!loading && tab === "players" && (
        <div role="tabpanel" id="panel-players" aria-labelledby="tab-players" className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-8">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Player</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">W</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">L</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">Win%</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {players.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-600">No players yet</td></tr>
              )}
              {players.map((player, i) => {
                const expanded = showPicks || expandedPlayer === player.id;
                const hasPicks = player.picks.length > 0;
                const toggle = () => setExpandedPlayer(expandedPlayer === player.id ? null : player.id);
                return (
                <Fragment key={player.id}>
                  <tr
                    onClick={toggle}
                    onKeyDown={hasPicks ? (e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
                    } : undefined}
                    role={hasPicks ? "button" : undefined}
                    tabIndex={hasPicks ? 0 : undefined}
                    aria-expanded={hasPicks ? expanded : undefined}
                    aria-controls={hasPicks && expanded ? `picks-${player.id}` : undefined}
                    className={`hover:bg-white/5 transition-colors cursor-pointer ${focusRing}`}
                  >
                    <td className="px-4 py-3 text-gray-600">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{player.realName ?? player.displayName}</div>
                      <div className="text-xs text-gray-500">
                        @{player.username}{player.teamName && ` · ${player.teamName}`}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-green-400 hidden sm:table-cell">{player.wins}</td>
                    <td className="px-4 py-3 text-right text-red-400 hidden sm:table-cell">{player.losses}</td>
                    <td className="px-4 py-3 text-right text-gray-400 hidden sm:table-cell">{(player.winPct * 100).toFixed(0)}%</td>
                    <td className="px-4 py-3 text-right font-semibold">{player.points}</td>
                  </tr>
                  {/* Picks row — shown via global toggle OR individual expand */}
                  {expanded && hasPicks && (
                    <tr key={`${player.id}-picks`} id={`picks-${player.id}`} className="bg-black/20">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="overflow-x-auto">
                          <table className="text-xs whitespace-nowrap">
                            <thead>
                              <tr>
                                {player.picks.sort((a, b) => a.week - b.week).map((pick) => (
                                  <th key={pick.week} className="text-left pr-5 pb-1.5 font-medium text-gray-500 uppercase tracking-wider">
                                    {pick.label.replace(/^Week (\d+)$/, "Wk $1")}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                {player.picks.sort((a, b) => a.week - b.week).map((pick) => {
                                  const glyph = pick.result === "WIN" ? "✓" : pick.result === "LOSS" ? "✗" : "–";
                                  const word = pick.result === "WIN" ? "Win" : pick.result === "LOSS" ? "Loss" : "Pending";
                                  return (
                                  <td key={pick.week} className={`pr-5 ${
                                    pick.result === "WIN" ? "text-green-400" :
                                    pick.result === "LOSS" ? "text-red-400" :
                                    "text-gray-500"
                                  }`}>
                                    {pick.team} <span aria-hidden="true">{glyph}</span>
                                    <span className="sr-only">{word}</span>
                                  </td>
                                  );
                                })}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Teams tab */}
      {!loading && tab === "teams" && (
        <div role="tabpanel" id="panel-teams" aria-labelledby="tab-teams" className="space-y-3">
          {teams.length === 0 && <p className="text-center py-10 text-gray-600 text-sm">No teams yet</p>}
          {teams.map((team, i) => (
            <div key={team.name} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 text-sm">#{i + 1}</span>
                  <span className="font-semibold">{team.name}</span>
                  <span className="text-xs text-gray-500">{team.playerCount} players</span>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{(team.avgWinPct * 100).toFixed(1)}%</div>
                  <div className="text-xs text-gray-500">avg win%</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {team.players.map((p) => (
                  <span key={p.displayName} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs text-gray-300">
                    {p.displayName}
                    <span className="text-gray-500 ml-1">{p.points}pts</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-white/5 px-4 py-3.5 last:border-b-0">
          <div className="h-4 w-4 rounded bg-white/10 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-32 rounded bg-white/10 animate-pulse" />
            <div className="h-3 w-20 rounded bg-white/10 animate-pulse" />
          </div>
          <div className="h-4 w-8 rounded bg-white/10 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
