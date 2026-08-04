"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { NAME_FIELD_LIMITS } from "@/lib/register";

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [emailReminders, setEmailReminders] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setDisplayName(data.displayName ?? "");
        setFirstName(data.firstName ?? "");
        setLastName(data.lastName ?? "");
        setEmail(data.email ?? "");
        setEmailReminders(data.emailReminders ?? true);
      });
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, firstName, lastName, email, emailReminders }),
    });
    const data = await res.json();
    if (res.ok) toast.success("Saved");
    else toast.error(data.error);
    setLoading(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (res.ok) {
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      toast.error(data.error);
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" htmlFor="firstName">
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={NAME_FIELD_LIMITS.firstName}
                autoComplete="given-name"
                placeholder="Jackson"
                className={input}
              />
            </Field>
            <Field label="Last Name" htmlFor="lastName">
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={NAME_FIELD_LIMITS.lastName}
                autoComplete="family-name"
                placeholder="Moss"
                className={input}
              />
            </Field>
          </div>
          <p className="text-xs text-gray-500">
            Your full name shown on the leaderboard. Leave both blank to hide it.
          </p>
          <Field
            label="Display Name"
            htmlFor="displayName"
            hint="The name others see next to your picks. Leave blank to use your first name."
          >
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={NAME_FIELD_LIMITS.displayName}
              className={input}
            />
          </Field>
          <Field label="Email" htmlFor="email" hint="Used for password reset. Leave blank to remove.">
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={input}
            />
          </Field>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={emailReminders}
              onChange={(e) => setEmailReminders(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 accent-blue-600"
            />
            <span className="text-sm text-gray-300">
              Email me pick reminders
              <span className="block text-xs text-gray-500">
                Get a nudge before kickoff when you haven&apos;t picked yet. Requires an email above.
              </span>
            </span>
          </label>
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
          <button type="submit" disabled={loading} className={btn}>
            Update Password
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-300">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

const input ="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors";
const btn = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 active:scale-95 disabled:opacity-50 transition-all";
