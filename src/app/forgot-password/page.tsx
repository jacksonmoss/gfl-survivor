"use client";

import { useState } from "react";
import Link from "next/link";

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
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">GFL Survivor</h1>
          <p className="mt-2 text-gray-400">Reset your password</p>
        </div>

        {submitted ? (
          <div className="space-y-4">
            <div className="rounded-md bg-green-900/50 border border-green-700 p-3 text-sm text-green-300">
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
          <form onSubmit={handleSubmit} className="space-y-4">
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
                className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
