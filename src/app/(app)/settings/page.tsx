"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState("");
  const [realName, setRealName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [teamName, setTeamName] = useState<string | null>(null);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDisplayName(data.displayName ?? "");
        setRealName(data.realName ?? "");
        setEmail(data.email ?? "");
        setTeamName(data.team?.name ?? null);
      });
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setProfileMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, realName, email }),
    });
    const data = await res.json();
    setProfileMsg(res.ok ? { type: "ok", text: "Saved" } : { type: "err", text: data.error });
    setLoading(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: "err", text: "Passwords do not match" });
      return;
    }
    setLoading(true);
    setPwMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (res.ok) {
      setPwMsg({ type: "ok", text: "Password updated" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setPwMsg({ type: "err", text: data.error });
    }
    setLoading(false);
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      {/* Profile card */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-5">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Profile</h2>
        <form onSubmit={saveProfile} className="space-y-4">
          <Field label="Display Name">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className={input}
            />
          </Field>
          <Field label="Real Name" hint="Your full name shown on the leaderboard. Leave blank to hide.">
            <input
              type="text"
              value={realName}
              onChange={(e) => setRealName(e.target.value)}
              placeholder="e.g. Jackson Moss"
              className={input}
            />
          </Field>
          <Field label="Email" hint="Used for password reset. Leave blank to remove.">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={input}
            />
          </Field>
          {teamName && (
            <Field label="Team">
              <div className="flex items-center h-10 px-3 rounded-lg border border-white/10 bg-white/5 text-sm text-gray-300">
                {teamName}
              </div>
            </Field>
          )}
          {profileMsg && <Feedback msg={profileMsg} />}
          <button type="submit" disabled={loading} className={btn}>
            Save Profile
          </button>
        </form>
      </div>

      {/* Password card */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-5">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Password</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <Field label="Current Password">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className={input}
            />
          </Field>
          <Field label="New Password">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className={input}
            />
          </Field>
          <Field label="Confirm New Password">
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className={input}
            />
          </Field>
          {pwMsg && <Feedback msg={pwMsg} />}
          <button type="submit" disabled={loading} className={btn}>
            Update Password
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Feedback({ msg }: { msg: { type: "ok" | "err"; text: string } }) {
  return (
    <p className={`text-sm ${msg.type === "ok" ? "text-green-400" : "text-red-400"}`}>
      {msg.text}
    </p>
  );
}

const input = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors";
const btn = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 active:scale-95 disabled:opacity-50 transition-all";
