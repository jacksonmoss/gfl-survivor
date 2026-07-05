"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authInput, authButton } from "@/lib/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
        displayName: formData.get("displayName"),
        inviteCode: formData.get("inviteCode"),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error);
      setLoading(false);
    } else {
      router.push("/login");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 animate-fade-in-up">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">GFL Survivor</h1>
          <p className="mt-2 text-gray-400">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
          {error && (
            <div className="rounded-lg bg-red-900/50 border border-red-700 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="inviteCode" className="block text-sm font-medium text-gray-300">
              Invite Code
            </label>
            <input
              id="inviteCode"
              name="inviteCode"
              type="text"
              required
              className={authInput}
            />
          </div>

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-300">
              Display Name
            </label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              required
              className={authInput}
            />
          </div>

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-300">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              className={authInput}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className={authInput}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={authButton}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-400 hover:text-blue-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
