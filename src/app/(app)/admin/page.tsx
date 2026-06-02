"use client";

import { useEffect, useState } from "react";

interface InviteCode {
  id: string;
  code: string;
  createdAt: string;
  usedBy: { displayName: string; username: string } | null;
}

interface Season {
  id: string;
  year: number;
  isActive: boolean;
  weeks: { id: string; label: string; weekNumber: number; _count: { games: number; picks: number } }[];
}

interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
}

export default function AdminPage() {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [newYear, setNewYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [importSeasonId, setImportSeasonId] = useState("");
  const [importWeek, setImportWeek] = useState(1);
  const [importResult, setImportResult] = useState("");
  const [importAll, setImportAll] = useState(false);
  const [syncResult, setSyncResult] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [resetUserId, setResetUserId] = useState("");
  const [tempPwResult, setTempPwResult] = useState<{ username: string; tempPassword: string } | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [invitesRes, seasonsRes, usersRes] = await Promise.all([
      fetch("/api/admin/invites"),
      fetch("/api/admin/season"),
      fetch("/api/admin/users"),
    ]);
    if (invitesRes.ok) setInvites(await invitesRes.json());
    if (seasonsRes.ok) {
      const data = await seasonsRes.json();
      setSeasons(data);
      if (data.length > 0 && !importSeasonId) {
        setImportSeasonId(data[0].id);
      }
    }
    if (usersRes.ok) {
      const data = await usersRes.json();
      setUsers(data);
      if (data.length > 0 && !resetUserId) {
        setResetUserId(data[0].id);
      }
    }
  }

  async function resetUserPassword() {
    if (!resetUserId) return;
    setResetLoading(true);
    setTempPwResult(null);
    const res = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: resetUserId }),
    });
    if (res.ok) {
      setTempPwResult(await res.json());
    }
    setResetLoading(false);
  }

  async function generateInvite() {
    setLoading(true);
    await fetch("/api/admin/invites", { method: "POST" });
    await fetchData();
    setLoading(false);
  }

  async function createSeason() {
    setLoading(true);
    await fetch("/api/admin/season", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: newYear }),
    });
    await fetchData();
    setLoading(false);
  }

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
        if (res.ok) {
          results.push(`W${week}: ${data.imported} imported, ${data.skipped} skipped`);
        } else {
          results.push(`W${week}: ${data.error}`);
        }
      }
      setImportResult(results.join("\n"));
    } else {
      const res = await fetch("/api/admin/import-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonId: importSeasonId, weekNumber: importWeek }),
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult(`Imported ${data.imported} games, skipped ${data.skipped}`);
      } else {
        setImportResult(`Error: ${data.error}`);
      }
    }

    await fetchData();
    setLoading(false);
  }

  async function syncScores() {
    setLoading(true);
    setSyncResult("");
    const res = await fetch("/api/scores/sync", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setSyncResult(`Synced ${data.synced} games, graded ${data.graded} picks (week ${data.week})`);
    } else {
      setSyncResult(`Error: ${data.error}`);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <h1 className="text-xl sm:text-2xl font-bold">Admin Panel</h1>

      {/* Live Scores Sync */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Live Scores</h2>
        <p className="text-sm text-gray-400">
          Fetch latest scores from ESPN and auto-grade finished games.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={syncScores}
            disabled={loading}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? "Syncing..." : "Sync Scores Now"}
          </button>
        </div>
        {syncResult && (
          <div className="rounded-md bg-gray-900 border border-gray-700 p-3 text-sm text-gray-300">
            {syncResult}
          </div>
        )}
      </section>

      {/* Season Management */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Seasons</h2>

        <div className="flex items-center gap-3">
          <input
            type="number"
            value={newYear}
            onChange={(e) => setNewYear(parseInt(e.target.value))}
            className="w-24 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white"
          />
          <button
            onClick={createSeason}
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create Season
          </button>
        </div>

        {seasons.map((season) => (
          <div
            key={season.id}
            className="rounded-lg border border-gray-700 bg-gray-800/50 p-3 sm:p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-semibold">{season.year}</span>
                {season.isActive && (
                  <span className="rounded-full bg-green-900/50 px-2 py-0.5 text-xs text-green-400 border border-green-800">
                    Active
                  </span>
                )}
              </div>
              <span className="text-sm text-gray-400">
                {season.weeks.length} weeks
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {season.weeks.map((w) => (
                <span
                  key={w.id}
                  className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300"
                >
                  {w.label} ({w._count.picks}p, {w._count.games}g)
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Import Schedule */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Import NFL Schedule</h2>
        <p className="text-sm text-gray-400">
          Pull real game schedules from ESPN for a season week.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Season</label>
            <select
              value={importSeasonId}
              onChange={(e) => setImportSeasonId(e.target.value)}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.year}
                </option>
              ))}
            </select>
          </div>

          {!importAll && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Week</label>
              <select
                value={importWeek}
                onChange={(e) => setImportWeek(parseInt(e.target.value))}
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                {Array.from({ length: 22 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>
                    {w <= 18 ? `Week ${w}` : w === 19 ? "Wild Card" : w === 20 ? "Divisional" : w === 21 ? "Conference" : "Super Bowl"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={importAll}
              onChange={(e) => setImportAll(e.target.checked)}
              className="rounded border-gray-600"
            />
            All weeks
          </label>

          <button
            onClick={importSchedule}
            disabled={loading || !importSeasonId}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Importing..." : "Import"}
          </button>
        </div>

        {importResult && (
          <pre className="rounded-md bg-gray-900 border border-gray-700 p-3 text-xs text-gray-300 whitespace-pre-wrap">
            {importResult}
          </pre>
        )}
      </section>

      {/* Invite Codes */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Invite Codes</h2>
          <button
            onClick={generateInvite}
            disabled={loading}
            className="rounded-md bg-blue-600 px-3 sm:px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Generate
          </button>
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-gray-400">Code</th>
                <th className="px-4 py-3 text-left text-gray-400">Status</th>
                <th className="px-4 py-3 text-left text-gray-400">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td className="px-4 py-3 font-mono text-xs">{invite.code}</td>
                  <td className="px-4 py-3">
                    {invite.usedBy ? (
                      <span className="text-gray-400">
                        Used by {invite.usedBy.displayName}
                      </span>
                    ) : (
                      <span className="text-green-400">Available</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(invite.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {invites.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-center text-gray-500">
                    No invite codes yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden space-y-2">
          {invites.map((invite) => (
            <div
              key={invite.id}
              className="rounded-lg border border-gray-700 bg-gray-800/50 p-3"
            >
              <div className="font-mono text-xs break-all">{invite.code}</div>
              <div className="mt-1 flex items-center justify-between text-xs">
                {invite.usedBy ? (
                  <span className="text-gray-400">
                    Used by {invite.usedBy.displayName}
                  </span>
                ) : (
                  <span className="text-green-400">Available</span>
                )}
                <span className="text-gray-500">
                  {new Date(invite.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
          {invites.length === 0 && (
            <div className="text-center py-4 text-gray-500 text-sm">
              No invite codes yet
            </div>
          )}
        </div>
      </section>

      {/* Password Resets (last resort) */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Password Resets</h2>
        <p className="text-sm text-gray-400">
          For players without an email on file. Generates a temporary password
          to relay to them; they should change it after signing in.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Player</label>
            <select
              value={resetUserId}
              onChange={(e) => {
                setResetUserId(e.target.value);
                setTempPwResult(null);
              }}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} (@{u.username}){u.email ? "" : " — no email"}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={resetUserPassword}
            disabled={resetLoading || !resetUserId}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {resetLoading ? "Resetting..." : "Reset Password"}
          </button>
        </div>

        {tempPwResult && (
          <div className="rounded-md bg-gray-900 border border-amber-700 p-3 text-sm">
            <div className="text-gray-300">
              Temporary password for{" "}
              <span className="font-medium">@{tempPwResult.username}</span>:
            </div>
            <div className="mt-1 font-mono text-base text-amber-300 break-all">
              {tempPwResult.tempPassword}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Shown once. Relay it securely; it won&apos;t be displayed again.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
