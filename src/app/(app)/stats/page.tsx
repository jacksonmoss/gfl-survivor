"use client";

import { useEffect, useState } from "react";
import { focusRing } from "@/lib/ui";
import { getTeamName } from "@/lib/nfl-teams";
import type { SeasonStats, WeeklyDigest } from "@/lib/stats";

interface SeasonOption { id: string; year: number; isActive: boolean }

export default function StatsPage() {
  const [stats, setStats] = useState<SeasonStats | null>(null);
  const [digests, setDigests] = useState<WeeklyDigest[]>([]);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [weekNumber, setWeekNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // No setState before the fetch resolves — the mount effect calls this, and a
  // synchronous setState there triggers a cascading render (and a lint error).
  // Callers that need the skeleton back flip `loading` themselves.
  function load(id?: string) {
    const url = id ? `/api/stats?seasonId=${id}` : "/api/stats";
    fetch(url).then((r) => r.json()).then((data) => {
      setLoading(false);
      setStats(data.stats ?? null);
      setDigests(data.digests ?? []);
      setSeasons(data.seasons ?? []);
      if (data.season) setSeasonId(data.season.id);
      // Digests come back newest first, so the most recent completed week is
      // the one worth opening on.
      setWeekNumber(data.digests?.[0]?.weekNumber ?? null);
    }).catch(() => {
      // Network/parse error — stop the skeleton and fall through to the empty
      // state rather than spinning forever (same as the leaderboard).
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  function onSeasonChange(id: string) {
    setSeasonId(id);
    setLoading(true);
    load(id);
  }

  const digest = digests.find((d) => d.weekNumber === weekNumber) ?? null;
  const hasData = stats !== null && stats.completedWeeks.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Stats</h1>
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

      {loading && <StatsSkeleton />}

      {!loading && !hasData && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-10 text-center">
          <p className="text-gray-400">No completed weeks yet</p>
          <p className="mt-1 text-sm text-gray-600">
            Stats appear once every game in a week is final.
          </p>
        </div>
      )}

      {!loading && hasData && stats && (
        <>
          {/* Season to date */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wider text-gray-400">
              Season to date
            </h2>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Weeks played" value={String(stats.completedWeeks.length)} />
              <Stat label="Picks made" value={String(stats.totals.picks)} />
              <Stat label="Pool hit rate" value={`${(stats.totals.winPct * 100).toFixed(0)}%`} />
              <Stat
                // Ties only join the label when the season actually has one, so
                // a push-free season doesn't advertise a column of zeroes.
                label={stats.totals.pushes > 0 ? "W–L–T" : "W–L"}
                value={`${stats.totals.wins}–${stats.totals.losses}${stats.totals.pushes > 0 ? `–${stats.totals.pushes}` : ""}`}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Standings">
                <ol className="space-y-2">
                  {stats.standings.slice(0, 5).map((row) => (
                    <li key={row.userId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-5 shrink-0 text-gray-600">{row.rank}</span>
                        <span className="truncate">{row.displayName}</span>
                      </span>
                      <span className="shrink-0 text-gray-400">
                        <span className="font-semibold text-white">{row.points}</span> pts
                        <span className="ml-2 text-xs text-gray-600">
                          {row.wins}–{row.losses}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>

              <Card title="Hot streaks">
                {stats.streaks.every((s) => s.current === 0 && s.longest === 0) ? (
                  <Empty>No winning streaks yet</Empty>
                ) : (
                  <ol className="space-y-2">
                    {stats.streaks.map((s) => (
                      <li key={s.userId} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{s.displayName}</span>
                        <span className="shrink-0 text-gray-400">
                          {s.current > 0 ? (
                            <span className="font-semibold text-green-400">W{s.current}</span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                          <span className="ml-2 text-xs text-gray-600">best {s.longest}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>

            <Card title="Most-picked teams">
              {stats.teamRecords.length === 0 ? (
                <Empty>No picks yet</Empty>
              ) : (
                <ul className="space-y-2">
                  {stats.teamRecords.map((t) => (
                    <li key={t.team} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">
                        <span className="font-medium">{t.team}</span>
                        <span className="ml-2 text-xs text-gray-600">{getTeamName(t.team)}</span>
                      </span>
                      <span className="shrink-0 text-gray-400">
                        {t.picks} {t.picks === 1 ? "pick" : "picks"}
                        <span className="ml-2 text-xs">
                          <span className="text-green-400">{t.wins}W</span>
                          <span className="ml-1 text-red-400">{t.losses}L</span>
                          {t.pushes > 0 && <span className="ml-1 text-yellow-400">{t.pushes}T</span>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          {/* Weekly breakdown */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium uppercase tracking-wider text-gray-400">
                Week breakdown
              </h2>
              <select
                aria-label="Select week"
                value={weekNumber ?? ""}
                onChange={(e) => setWeekNumber(Number(e.target.value))}
                className={`rounded-lg border border-white/10 bg-gray-900 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none ${focusRing}`}
              >
                {digests.map((d) => (
                  <option key={d.weekNumber} value={d.weekNumber}>{d.label}</option>
                ))}
              </select>
            </div>

            {digest && <WeekDigest digest={digest} />}
          </section>
        </>
      )}
    </div>
  );
}

function WeekDigest({ digest }: { digest: WeeklyDigest }) {
  const nothingNotable =
    !digest.mostPickedTeam &&
    digest.upsets.length === 0 &&
    digest.perfectGames.length === 0 &&
    digest.whiffedGames.length === 0;

  return (
    <div className="space-y-3 animate-fade-in-up">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Picks" value={String(digest.pickCount)} />
        <Stat label="Correct" value={String(digest.correctCount)} />
        <Stat label="Losses" value={String(digest.losses.total)} />
        <Stat
          label="Worth"
          value={`${digest.pointValue} ${digest.pointValue === 1 ? "pt" : "pts"}`}
          hint={digest.isPlayoff ? "playoff" : undefined}
        />
      </div>

      {nothingNotable && digest.pickCount === 0 && (
        <Card title="No picks"><Empty>Nobody picked this week</Empty></Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title={digest.leaders.length > 1 ? "Co-leaders" : "Leader"}>
          <p className="text-sm">
            {digest.leaders.map((l) => l.displayName).join(", ")}
            <span className="ml-2 text-gray-400">
              <span className="font-semibold text-white">{digest.leaders[0]?.points ?? 0}</span> pts
            </span>
          </p>
          {digest.leadChange ? (
            <ul className="mt-2 space-y-1 text-sm text-gray-400">
              <li>
                {digest.leadChange.leadChanged ? (
                  <>
                    Lead change — was{" "}
                    <span className="text-white">{digest.leadChange.previousLeaders.join(", ")}</span>
                  </>
                ) : (
                  "Lead held"
                )}
              </li>
              {digest.leadChange.biggestRiser && (
                <li>
                  <span className="text-green-400">▲</span>{" "}
                  <span className="text-white">{digest.leadChange.biggestRiser.displayName}</span>{" "}
                  {digest.leadChange.biggestRiser.from} → {digest.leadChange.biggestRiser.to}
                </li>
              )}
              {digest.leadChange.biggestFaller && (
                <li>
                  <span className="text-red-400">▼</span>{" "}
                  <span className="text-white">{digest.leadChange.biggestFaller.displayName}</span>{" "}
                  {digest.leadChange.biggestFaller.from} → {digest.leadChange.biggestFaller.to}
                </li>
              )}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-600">First completed week — no prior standings</p>
          )}
        </Card>

        <Card title="Crowd">
          {digest.mostPickedTeam ? (
            <ul className="space-y-1.5 text-sm text-gray-400">
              <li>
                Most picked:{" "}
                <span className="text-white">{digest.mostPickedTeam.team}</span>{" "}
                <span className="text-xs">
                  ({digest.mostPickedTeam.count}, {(digest.mostPickedTeam.pct * 100).toFixed(0)}%)
                </span>
              </li>
              {digest.mostPickedGame && (
                <li>
                  Busiest game:{" "}
                  <span className="text-white">
                    {digest.mostPickedGame.awayTeam} @ {digest.mostPickedGame.homeTeam}
                  </span>{" "}
                  <span className="text-xs">({digest.mostPickedGame.count})</span>
                </li>
              )}
              <li>
                Consensus bust:{" "}
                {digest.consensusBust ? (
                  <span className="text-red-400">
                    {digest.consensusBust.team}{" "}
                    <span className="text-xs text-gray-500">({digest.consensusBust.count} burned)</span>
                  </span>
                ) : (
                  <span className="text-gray-600">none — the crowd was right</span>
                )}
              </li>
            </ul>
          ) : (
            <Empty>No picks this week</Empty>
          )}
        </Card>
      </div>

      <Card title="Upsets">
        {digest.upsets.length === 0 ? (
          <Empty>No underdog wins with a posted line</Empty>
        ) : (
          <ul className="space-y-2.5">
            {digest.upsets.map((u) => (
              <li key={`${u.homeTeam}-${u.awayTeam}`} className="text-sm">
                <span className="font-medium text-white">{u.winner}</span>{" "}
                <span className="text-gray-400">
                  beat {u.loser} {Math.max(u.homeScore, u.awayScore)}–{Math.min(u.homeScore, u.awayScore)} as a{" "}
                  {u.underdogBy}-point dog
                </span>
                {(u.benefited.length > 0 || u.burned.length > 0) && (
                  <div className="mt-0.5 text-xs text-gray-500">
                    {u.benefited.length > 0 && (
                      <span className="text-green-400">cashed: {u.benefited.join(", ")}</span>
                    )}
                    {u.benefited.length > 0 && u.burned.length > 0 && <span className="mx-1.5">·</span>}
                    {u.burned.length > 0 && (
                      <span className="text-red-400">burned: {u.burned.join(", ")}</span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Sweeps">
          {digest.perfectGames.length === 0 && digest.whiffedGames.length === 0 ? (
            <Empty>Nobody swept a game</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {digest.perfectGames.map((s) => (
                <li key={`p-${s.homeTeam}-${s.awayTeam}`}>
                  <span className="text-green-400">All {s.count} on {s.team}</span>{" "}
                  <span className="text-xs text-gray-500">
                    ({s.awayTeam} @ {s.homeTeam}) — {s.players.join(", ")}
                  </span>
                </li>
              ))}
              {digest.whiffedGames.map((s) => (
                <li key={`w-${s.homeTeam}-${s.awayTeam}`}>
                  <span className="text-red-400">All {s.count} on {s.team}</span>{" "}
                  <span className="text-xs text-gray-500">
                    ({s.awayTeam} @ {s.homeTeam}) — {s.players.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Notable losses">
          {digest.losses.total === 0 ? (
            <Empty>Nobody lost this week</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm text-gray-400">
              <li>
                <span className="font-semibold text-white">{digest.losses.total}</span>{" "}
                {digest.losses.total === 1 ? "player" : "players"} lost
              </li>
              {digest.losses.leadersWhoLost.length > 0 && (
                <li>
                  Leader down:{" "}
                  <span className="text-red-400">{digest.losses.leadersWhoLost.join(", ")}</span>
                </li>
              )}
              {digest.losses.streakBroken && (
                <li>
                  Streak snapped:{" "}
                  <span className="text-white">{digest.losses.streakBroken.displayName}</span>{" "}
                  <span className="text-xs">after {digest.losses.streakBroken.streak} straight</span>
                </li>
              )}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-gray-500">
        {label}
        {hint && <span className="ml-1 text-blue-400">{hint}</span>}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-2.5 text-xs font-medium uppercase tracking-wider text-gray-500">{title}</h3>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-600">{children}</p>;
}

function StatsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="h-5 w-12 rounded bg-white/10 animate-pulse" />
            <div className="mt-1.5 h-3 w-16 rounded bg-white/10 animate-pulse" />
          </div>
        ))}
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2.5">
          <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />
          {Array.from({ length: 4 }).map((_, j) => (
            <div key={j} className="h-4 w-full rounded bg-white/10 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}
