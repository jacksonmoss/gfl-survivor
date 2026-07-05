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
// instance. This is the only place we can return a real 429 for the NextAuth
// credentials callback, which is otherwise handled entirely inside NextAuth.
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
  {
    // NextAuth posts credentials sign-ins here.
    path: "/api/auth/callback/credentials",
    prefix: "login",
    config: AUTH_RATE_LIMITS.login,
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
  matcher: [
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/callback/credentials",
  ],
};
