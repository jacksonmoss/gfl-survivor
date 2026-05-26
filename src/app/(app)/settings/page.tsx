"use client";

import { useEffect, useState } from "react";

interface Team {
  id: string;
  name: string;
  members: { id: string; displayName: string }[];
}

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Teams
  const [teams, setTeams] = useState<Team[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [teamError, setTeamError] = useState("");
  const [teamMessage, setTeamMessage] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDisplayName(data.displayName || "");
      });
    fetchTeams();
  }, []);

  async function fetchTeams() {
    const res = await fetch("/api/teams");
    const data = await res.json();
    setTeams(data.teams);
    setMyTeamId(data.myTeamId);
  }

  async function handleProfileUpdate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });

    const data = await res.json();
    if (res.ok) {
      setMessage("Display name updated");
    } else {
      setError(data.error);
    }
    setLoading(false);
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await res.json();
    if (res.ok) {
      setMessage("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setError(data.error);
    }
    setLoading(false);
  }

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    setTeamError("");
    setTeamMessage("");

    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", teamName: newTeamName }),
    });

    const data = await res.json();
    if (res.ok) {
      setTeamMessage(`Created and joined team "${newTeamName}"`);
      setNewTeamName("");
      fetchTeams();
    } else {
      setTeamError(data.error);
    }
  }

  async function joinTeam(teamId: string) {
    setTeamError("");
    setTeamMessage("");

    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", teamId }),
    });

    if (res.ok) {
      setTeamMessage("Joined team");
      fetchTeams();
    } else {
      const data = await res.json();
      setTeamError(data.error);
    }
  }

  async function leaveTeam() {
    setTeamError("");
    setTeamMessage("");

    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "leave" }),
    });

    if (res.ok) {
      setTeamMessage("Left team");
      fetchTeams();
    }
  }

  const myTeam = teams.find((t) => t.id === myTeamId);

  return (
    <div className="space-y-8 max-w-lg">
      <h1 className="text-xl sm:text-2xl font-bold">Settings</h1>

      {message && (
        <div className="rounded-md bg-green-900/50 border border-green-700 p-3 text-sm text-green-300">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md bg-red-900/50 border border-red-700 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Profile */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Profile</h2>
        <form onSubmit={handleProfileUpdate} className="space-y-3">
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-300">
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Update Profile
          </button>
        </form>
      </section>

      {/* Team */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Team Trophy</h2>

        {teamMessage && (
          <div className="rounded-md bg-green-900/50 border border-green-700 p-3 text-sm text-green-300">
            {teamMessage}
          </div>
        )}
        {teamError && (
          <div className="rounded-md bg-red-900/50 border border-red-700 p-3 text-sm text-red-300">
            {teamError}
          </div>
        )}

        {myTeam ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-3 sm:p-4">
              <div className="text-xs text-gray-400">Your team</div>
              <div className="mt-1 text-lg font-semibold">{myTeam.name}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {myTeam.members.map((m) => (
                  <span key={m.id} className="rounded-md bg-gray-700 px-2 py-1 text-xs">
                    {m.displayName}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={leaveTeam}
              className="rounded-md bg-red-600/20 border border-red-700 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-600/30"
            >
              Leave Team
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <form onSubmit={createTeam} className="flex gap-2">
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="New team name"
                required
                className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create
              </button>
            </form>

            {teams.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-gray-400">Or join an existing team:</div>
                <div className="space-y-2">
                  {teams.map((team) => (
                    <div
                      key={team.id}
                      className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800/50 p-3"
                    >
                      <div>
                        <div className="font-medium text-sm">{team.name}</div>
                        <div className="text-xs text-gray-400">
                          {team.members.length} member{team.members.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <button
                        onClick={() => joinTeam(team.id)}
                        className="rounded-md bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-600"
                      >
                        Join
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Password */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Change Password</h2>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-300">
              Current Password
            </label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-300">
              New Password
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300">
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Change Password
          </button>
        </form>
      </section>
    </div>
  );
}
