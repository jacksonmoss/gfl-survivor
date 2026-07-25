"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { authInput, authButton } from "@/lib/ui";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } else {
      setError(data.error ?? "Something went wrong");
    }
  }

  if (!token) {
    return (
      <div className="rounded-lg bg-red-900/50 border border-red-700 p-3 text-sm text-red-300">
        Missing reset token. Please use the link from your email.
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-green-900/50 border border-green-700 p-3 text-sm text-green-300">
          Password updated. Redirecting to sign in...
        </div>
        <p className="text-center text-sm text-gray-400">
          <Link href="/login" className="text-blue-400 hover:text-blue-300">
            Sign in now
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
      {error && (
        <div className="rounded-lg bg-red-900/50 border border-red-700 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-gray-300"
        >
          New password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={authInput}
        />
      </div>
      <div>
        <label
          htmlFor="confirm"
          className="block text-sm font-medium text-gray-300"
        >
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={authInput}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className={authButton}
      >
        {loading ? "Updating..." : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 animate-fade-in-up">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">GFL Survivor</h1>
          <p className="mt-2 text-gray-400">Choose a new password</p>
        </div>
        <Suspense fallback={<div className="text-center text-gray-400">Loading...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
