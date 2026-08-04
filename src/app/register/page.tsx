"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authInput, authButton } from "@/lib/ui";
import { NAME_FIELD_LIMITS } from "@/lib/register";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // A shared link (#110/#111) carries the code as ?invite=. When present we
  // prefill + hide the field so the user just picks a name and password.
  const linkedInvite = searchParams.get("invite")?.trim() ?? "";
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
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
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
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
      {error && (
        <div className="rounded-lg bg-red-900/50 border border-red-700 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {linkedInvite ? (
        // Prefilled from the link — keep the value posted, but don't make the
        // user look at a raw code box; a disabled/invalid code still surfaces
        // the API error above on submit (no silent failure).
        <>
          <input type="hidden" name="inviteCode" value={linkedInvite} />
          <div className="rounded-lg bg-blue-950/50 border border-blue-800 p-3 text-sm text-blue-200">
            Joining GFL Survivor — just pick a name and password below.
          </div>
        </>
      ) : (
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
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-gray-300">
            First name <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            maxLength={NAME_FIELD_LIMITS.firstName}
            autoComplete="given-name"
            className={authInput}
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-gray-300">
            Last name <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            maxLength={NAME_FIELD_LIMITS.lastName}
            autoComplete="family-name"
            className={authInput}
          />
        </div>
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
          maxLength={NAME_FIELD_LIMITS.username}
          autoComplete="username"
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
  );
}

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 animate-fade-in-up">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">GFL Survivor</h1>
          <p className="mt-2 text-gray-400">Create your account</p>
        </div>

        <Suspense fallback={<div className="text-center text-gray-400">Loading...</div>}>
          <RegisterForm />
        </Suspense>

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
