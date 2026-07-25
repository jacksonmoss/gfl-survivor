"use client";

import { useState } from "react";
import Link from "next/link";
import { authInput, authButton } from "@/lib/ui";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    setSubmitted(true);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 animate-fade-in-up">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">GFL Survivor</h1>
          <p className="mt-2 text-gray-400">Reset your password</p>
        </div>

        {submitted ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-900/50 border border-green-700 p-3 text-sm text-green-300">
              If an account with an email on file matches that, a reset link is
              on its way. The link expires in 1 hour.
            </div>
            <p className="text-center text-sm text-gray-400">
              No email on file?{" "}
              <span className="text-gray-300">
                Ask a league admin to reset your password.
              </span>
            </p>
            <p className="text-center text-sm text-gray-400">
              <Link href="/login" className="text-blue-400 hover:text-blue-300">
                Back to sign in
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-gray-400">
              Enter your username or email and we&apos;ll send a reset link to
              the email on your account.
            </p>
            <div>
              <label
                htmlFor="identifier"
                className="block text-sm font-medium text-gray-300"
              >
                Username or email
              </label>
              <input
                id="identifier"
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={authInput}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className={authButton}
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
            <p className="text-center text-sm text-gray-400">
              <Link href="/login" className="text-blue-400 hover:text-blue-300">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
