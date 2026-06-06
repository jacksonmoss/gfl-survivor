"use client";

import { useEffect, useState } from "react";

interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  teamId: string | null;
}

interface Team {
  id: string;
  name: string;
  members: { id: string; displayName: string }[];
}

interface Season {
  id: string;
  year: number;
  isActive: boolean;
  weeks: { id: string; label: string; weekNumber: number; _count: { games: number; picks: number } }[];
}

type Tab = "players" | "teams" | "season" | "import" | "invites";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("players");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(false);

  // Players tab
  const [resetUserId, setResetUserId] = useState("");
  const [tempPwResult, setTempPwResult] = useState<{ username: string; tempPassword: string } | null>(null);

  // Teams tab
  const [newTeamName, setNewTeamName] = useState("");
  const [teamMsg, setTeamMsg] = useState("");
  const [assignUserId, setAssignUserId] = useState("");
  const [assignTeamId, setAssignTeamId] = useState("");

  // Season tab
  const [newYear, setNewYear] = useState(new Date().getFullYear());

  // Import tab
  const [importSeasonId, setImportSeasonId] = useState("");
  const [importWeek, setImportWeek] = useState(1);
  const [importAll, setImportAll] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [syncResult, setSyncResult] = useState("");

  // Invites tab
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [availableCodes, setAvailableCodes] = useState(0);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const [usersRes, teamsRes, seasonsRes, invitesRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/teams"),
      fetch("/api/admin/season"),
      fetch("/api/admin/invites"),
    ]);

    if (usersRes.ok) {
      const data = await usersRes.json();
      setUsers(data);
      if (data.length > 0) setResetUserId(data[0].id);
    }
    if (teamsRes.ok) {
      const data = await teamsRes.json();
      setTeams(data.teams ?? []);
    }
    if (seasonsRes.ok) {
      const data = await seasonsRes.json();
      setSeasons(data);
      if (data.length > 0 && !importSeasonId) setImportSeasonId(data[0].id);
    }
    if (invitesRes.ok) {
      const data = await invitesRes.json();
      const available = (data as { usedBy: unknown }[]).filter((c) => !c.usedBy).length;
      setAvailableCodes(available);
    }
  }

  // --- Players ---
  async function resetPassword() {
    if (!resetUserId) return;
    setLoading(true);
    setTempPwResult(null);
    const res = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: resetUserId }),
    });
    if (res.ok) setTempPwResult(await res.json());
    setLoading(false);
  }

  // --- Teams ---
  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setLoading(true);
    setTeamMsg("");
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", teamName: newTeamName.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setNewTeamName("");
      setTeamMsg(`Created "${data.name}"`);
      await loadAll();
    } else {
      setTeamMsg(data.error);
    }
    setLoading(false);
  }

  async function assignMember() {
    if (!assignUserId || !assignTeamId) return;
    setLoading(true);
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", userId: assignUserId, teamId: assignTeamId }),
    });
    await loadAll();
    setLoading(false);
  }

  async function unassignMember(userId: string) {
    setLoading(true);
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unassign", userId }),
    });
    await loadAll();
    setLoading(false);
  }

  async function deleteTeam(teamId: string) {
    if (!confirm("Delete this team? Members will be unassigned.")) return;
    setLoading(true);
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", teamId }),
    });
    await loadAll();
    setLoading(false);
  }

  // --- Season ---
  async function createSeason() {
    setLoading(true);
    await fetch("/api/admin/season", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: newYear }),
    });
    await loadAll();
    setLoading(false);
  }

  // --- Import ---
  async function importSchedule() {
    setLoading(true);
    setImportResult("");
    if (importAll) {
      const results: string[] = [];
      for (let week = 1; week <= 22; week++) {
        const res = await fetch("/api/admin/import-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seasonId: importSeasonId, weekNumber: week }),
        });
        const data = await res.json();
        results.push(res.ok ? `W${week}: ${data.imported} imported, ${data.skipped} skipped` : `W${week}: ${data.error}`);
      }
      setImportResult(results.join("\n"));
    } else {
      const res = await fetch("/api/admin/import-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonId: importSeasonId, weekNumber: importWeek }),
      });
      const data = await res.json();
      setImportResult(res.ok ? `Imported ${data.imported} games, skipped ${data.skipped}` : `Error: ${data.error}`);
    }
    await loadAll();
    setLoading(false);
  }

  async function syncScores() {
    setLoading(true);
    setSyncResult("");
    const res = await fetch("/api/scores/sync", { method: "POST" });
    const data = await res.json();
    setSyncResult(res.ok
      ? `Synced ${data.synced} games, graded ${data.graded} picks (week ${data.week})`
      : `Error: ${data.error}`);
    setLoading(false);
  }

  // --- Invites ---
  async function generateInvite() {
    setLoading(true);
    const res = await fetch("/api/admin/invites", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setLatestCode(data.code);
      setAvailableCodes((n) => n + 1);
    }
    setLoading(false);
  }

  const unassignedUsers = users.filter((u) => !u.teamId && u.role !== "ADMIN");
  const tabs: { id: Tab; label: string }[] = [
    { id: "players", label: "Players" },
    { id: "teams", label: "Teams" },
    { id: "season", label: "Season" },
    { id: "import", label: "Import" },
    { id: "invites", label: "Invites" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Admin</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/10 pb-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2 ${
              tab === t.id
                ? "border-blue-500 text-white"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Players tab */}
      {tab === "players" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Player</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Team</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.displayName}</div>
                      <div className="text-xs text-gray-500">@{u.username}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden sm:table-cell">
                      {u.email ?? <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-sm">
                      {teams.find((t) => t.id === u.teamId)?.name ?? <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === "ADMIN" ? "bg-blue-900/50 text-blue-300 border border-blue-800" : "bg-white/5 text-gray-500"}`}>
                        {u.role}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Password reset */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
            <h3 className="text-sm font-medium text-gray-300">Emergency Password Reset</h3>
            <p className="text-xs text-gray-500">For players without a recovery email. Generates a one-time temp password — relay it to them directly.</p>
            <div className="flex gap-2 flex-wrap">
              <select
                value={resetUserId}
                onChange={(e) => { setResetUserId(e.target.value); setTempPwResult(null); }}
                className={select}
              >
                {users.filter((u) => u.role !== "ADMIN").map((u) => (
                  <option key={u.id} value={u.id}>{u.displayName} (@{u.username}){u.email ? "" : " — no email"}</option>
                ))}
              </select>
              <button onClick={resetPassword} disabled={loading || !resetUserId} className={btn}>
                Generate Temp Password
              </button>
            </div>
            {tempPwResult && (
              <div className="rounded-lg bg-yellow-950 border border-yellow-800 p-3 text-sm space-y-1">
                <p className="text-yellow-400 font-medium">Temp password for @{tempPwResult.username}</p>
                <p className="font-mono text-white text-base tracking-wider">{tempPwResult.tempPassword}</p>
                <p className="text-yellow-600 text-xs">Share this directly. It won&apos;t be shown again.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Teams tab */}
      {tab === "teams" && (
        <div className="space-y-6">
          {/* Create team */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
            <h3 className="text-sm font-medium text-gray-300">Create Team</h3>
            <form onSubmit={createTeam} className="flex gap-2">
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Team name"
                className={`${input} flex-1`}
              />
              <button type="submit" disabled={loading || !newTeamName.trim()} className={btn}>
                Create
              </button>
            </form>
            {teamMsg && <p className="text-sm text-gray-400">{teamMsg}</p>}
          </div>

          {/* Assign member */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
            <h3 className="text-sm font-medium text-gray-300">Assign Player to Team</h3>
            <div className="flex gap-2 flex-wrap">
              <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)} className={select}>
                <option value="">Select player...</option>
                {unassignedUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.displayName}</option>
                ))}
              </select>
              <select value={assignTeamId} onChange={(e) => setAssignTeamId(e.target.value)} className={select}>
                <option value="">Select team...</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button onClick={assignMember} disabled={loading || !assignUserId || !assignTeamId} className={btn}>
                Assign
              </button>
            </div>
          </div>

          {/* Team roster */}
          <div className="space-y-3">
            {teams.length === 0 && <p className="text-gray-500 text-sm">No teams yet.</p>}
            {teams.map((team) => (
              <div key={team.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{team.name}</span>
                  <button
                    onClick={() => deleteTeam(team.id)}
                    disabled={loading}
                    className="text-xs text-red-500 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {team.members.length === 0 && <span className="text-xs text-gray-600">No members</span>}
                  {team.members.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-xs">
                      {m.displayName}
                      <button
                        onClick={() => unassignMember(m.id)}
                        disabled={loading}
                        className="text-gray-500 hover:text-red-400 transition-colors leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Season tab */}
      {tab === "season" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
            <h3 className="text-sm font-medium text-gray-300">Create Season</h3>
            <div className="flex gap-2">
              <input
                type="number"
                value={newYear}
                onChange={(e) => setNewYear(parseInt(e.target.value))}
                className={`${input} w-28`}
              />
              <button onClick={createSeason} disabled={loading} className={btn}>
                Create
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {seasons.map((season) => (
              <div key={season.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{season.year}</span>
                  {season.isActive && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-400 border border-green-800">Active</span>
                  )}
                  <span className="text-xs text-gray-500 ml-auto">{season.weeks.length} weeks</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {season.weeks.map((w) => (
                    <span key={w.id} className="rounded bg-white/5 px-2 py-0.5 text-xs text-gray-400">
                      {w.label} ({w._count.picks}p)
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import tab */}
      {tab === "import" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-300">Sync Live Scores</h3>
              <p className="text-xs text-gray-500 mt-1">Fetch latest scores from ESPN and auto-grade finished games.</p>
            </div>
            <button onClick={syncScores} disabled={loading} className={`${btn} bg-green-700 hover:bg-green-600`}>
              Sync Now
            </button>
            {syncResult && <p className="text-sm text-gray-300 bg-white/5 rounded-lg px-3 py-2">{syncResult}</p>}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-300">Import NFL Schedule</h3>
              <p className="text-xs text-gray-500 mt-1">Pull game schedules from ESPN.</p>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Season</label>
                <select value={importSeasonId} onChange={(e) => setImportSeasonId(e.target.value)} className={select}>
                  {seasons.map((s) => <option key={s.id} value={s.id}>{s.year}</option>)}
                </select>
              </div>
              {!importAll && (
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Week</label>
                  <select value={importWeek} onChange={(e) => setImportWeek(parseInt(e.target.value))} className={select}>
                    {Array.from({ length: 22 }, (_, i) => i + 1).map((w) => (
                      <option key={w} value={w}>
                        {w <= 18 ? `Week ${w}` : ["", "", "Wild Card", "Divisional", "Conf. Championship", "Super Bowl"][w - 18] ?? `Week ${w}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-300 pb-2">
                <input type="checkbox" checked={importAll} onChange={(e) => setImportAll(e.target.checked)} className="rounded border-gray-600" />
                All weeks
              </label>
              <button onClick={importSchedule} disabled={loading || !importSeasonId} className={`${btn} pb-2`}>
                Import
              </button>
            </div>
            {importResult && (
              <pre className="rounded-lg bg-black/30 border border-white/5 p-3 text-xs text-gray-300 whitespace-pre-wrap">
                {importResult}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Invites tab */}
      {tab === "invites" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-gray-300">Invite Codes</h3>
                <p className="text-xs text-gray-500 mt-0.5">{availableCodes} unused code{availableCodes !== 1 ? "s" : ""} available</p>
              </div>
              <button onClick={generateInvite} disabled={loading} className={btn}>
                Generate
              </button>
            </div>
            {latestCode && (
              <div className="rounded-lg bg-blue-950 border border-blue-800 p-3 space-y-1">
                <p className="text-xs text-blue-400">New invite code</p>
                <p className="font-mono text-white text-sm tracking-wider break-all">{latestCode}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const input = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors";
const select = "rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none";
const btn = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 active:scale-95 disabled:opacity-50 transition-all";
