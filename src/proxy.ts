import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  rateLimit,
  getClientIp,
  AUTH_RATE_LIMITS,
  type RateLimitConfig,
} from "@/lib/rate-limit";

// Rate-limit the sensitive auth endpoints by client IP (issue #5). Proxy (the
// Next 16 rename of middleware) defaults to the Node.js runtime, so the
// in-memory store in lib/rate-limit persists across requests in a single
// instance. Login is NOT limited here: the proxy runs in a separate module
// context from the route handlers and can't see the auth result, so it can't
// count failed logins only — that lives in the `authorize` callback in
// src/lib/auth.ts instead (issue #46).
const RULES: { path: string; prefix: string; config: RateLimitConfig }[] = [
  {
    path: "/api/auth/forgot-password",
    prefix: "forgot-password",
    config: AUTH_RATE_LIMITS.forgotPassword,
  },
  {
    path: "/api/auth/reset-password",
    prefix: "reset-password",
    config: AUTH_RATE_LIMITS.resetPassword,
  },
];

export function proxy(request: NextRequest) {
  // Escape hatch for the E2E suite, which logs in far more often than a human
  // would and shares one client IP. Never set this in production.
  if (process.env.RATE_LIMIT_DISABLED === "true") return NextResponse.next();

  // Only the submission (POST) matters; NextAuth also GETs the callback path.
  if (request.method !== "POST") return NextResponse.next();

  const rule = RULES.find((r) => r.path === request.nextUrl.pathname);
  if (!rule) return NextResponse.next();

  const ip = getClientIp(request.headers);
  const result = rateLimit(`${rule.prefix}:${ip}`, rule.config);

  if (result.limited) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(result.retryAfterSeconds) },
      }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/auth/forgot-password", "/api/auth/reset-password"],
};
