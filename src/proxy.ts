import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  rateLimit,
  getClientIp,
  findProxyRateLimitRule,
} from "@/lib/rate-limit";

// Rate-limit the sensitive auth endpoints by client IP (issues #5, #134). Proxy
// (the Next 16 rename of middleware) defaults to the Node.js runtime, so the
// in-memory store in lib/rate-limit persists across requests in a single
// instance. Which paths are guarded — and the pure method/path matching — live
// in lib/rate-limit (PROXY_RATE_LIMIT_RULES), so they're unit-testable; the
// matcher below must list the same paths (asserted in rate-limit.test.ts).
// Login is NOT limited here: the proxy runs in a separate module context from
// the route handlers and can't see the auth result, so it can't count failed
// logins only — that lives in the `authorize` callback in src/lib/auth.ts
// (issue #46).

export function proxy(request: NextRequest) {
  // Escape hatch for the E2E suite, which logs in far more often than a human
  // would and shares one client IP. Never set this in production.
  if (process.env.RATE_LIMIT_DISABLED === "true") return NextResponse.next();

  const rule = findProxyRateLimitRule(request.method, request.nextUrl.pathname);
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

// Must stay in sync with PROXY_RATE_LIMIT_RULES — Next requires a statically
// analyzable literal here, so it can't be derived from that table.
export const config = {
  matcher: [
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/register",
  ],
};
