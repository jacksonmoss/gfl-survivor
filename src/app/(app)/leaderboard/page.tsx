"use client";

import { Fragment, useEffect, useState } from "react";
import { getTeamName } from "@/lib/nfl-teams";

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
  const [showPicks, setShowPicks] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);

  function load(id?: string) {
    const url = id ? `/api/leaderboard?seasonId=${id}` : "/api/leaderboard";
    fetch(url).then((r) => r.json()).then((data) => {
      setPlayers(data.players ?? []);
      setTeams(data.teams ?? []);
      setSeasons(data.seasons ?? []);
      if (data.season) setSeasonId(data.season.id);
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
              value={seasonId}
              onChange={(e) => onSeasonChange(e.target.value)}
              className="rounded-lg border border-white/10 bg-gray-900 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
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
        <div className="flex gap-1">
          {(["players", "teams"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2 capitalize ${
                tab === t ? "border-blue-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "teams" ? "Team Trophy" : "Players"}
            </button>
          ))}
        </div>
        {tab === "players" && (
          <button
            onClick={() => setShowPicks((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-all mb-1 ${
              showPicks
                ? "border-blue-500 bg-blue-900/30 text-blue-300"
                : "border-white/10 text-gray-500 hover:text-gray-300"
            }`}
          >
            {showPicks ? "Hide Picks" : "Show Picks"}
          </button>
        )}
      </div>

      {/* Players tab */}
      {tab === "players" && (
        <div className="rounded-xl border border-white/10 overflow-hidden">
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
              {players.map((player, i) => (
                <Fragment key={player.id}>
                  <tr
                    onClick={() => setExpandedPlayer(expandedPlayer === player.id ? null : player.id)}
                    className="hover:bg-white/5 transition-colors cursor-pointer"
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
                  {(showPicks || expandedPlayer === player.id) && player.picks.length > 0 && (
                    <tr key={`${player.id}-picks`} className="bg-black/20">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {player.picks.sort((a, b) => a.week - b.week).map((pick) => (
                            <span
                              key={pick.week}
                              className={`inline-flex items-center rounded-md px-2 py-1 text-xs border ${
                                pick.result === "WIN" ? "bg-green-900/30 border-green-800 text-green-300" :
                                pick.result === "LOSS" ? "bg-red-900/20 border-red-900 text-red-400" :
                                "bg-white/5 border-white/10 text-gray-400"
                              }`}
                            >
                              {pick.label}: {getTeamName(pick.team)}
                              {pick.points > 0 && <span className="ml-1 text-gray-500">+{pick.points}</span>}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Teams tab */}
      {tab === "teams" && (
        <div className="space-y-3">
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
