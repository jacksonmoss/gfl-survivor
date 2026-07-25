import { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import {
  rateLimit,
  peekRateLimit,
  resetRateLimit,
  getClientIp,
  AUTH_RATE_LIMITS,
} from "./rate-limit";

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        // Login rate limiting lives here, not in the proxy (issue #46). The proxy
        // runs in a separate module context, so its in-memory bucket can't see
        // the auth *result* — it would either count every request (successes too,
        // the bug #46 describes) or, if it only peeked, never see the failures.
        // Enforcing in `authorize` keeps one shared window that counts *failed*
        // attempts only: successful logins never consume budget and reset it.
        // Over the limit we return null — a 401 indistinguishable from a wrong
        // password, so the block doesn't advertise itself (see closed #45).
        // Keyed by client IP (matching brute force from one source; avoids a
        // per-username lockout DoS). Single-instance only, same as all our limits.
        // Escape hatch for the E2E suite, which logs in far more often than a
        // human and shares one client IP (mirrors the proxy's guard for the
        // other auth limits). Never set this in production.
        const limitEnabled = process.env.RATE_LIMIT_DISABLED !== "true";
        const loginKey = `login:${getClientIp(req?.headers)}`;

        // Peek first so a locked-out caller is rejected before any DB/bcrypt work.
        if (limitEnabled && peekRateLimit(loginKey, AUTH_RATE_LIMITS.login).limited) {
          return null;
        }

        const countFailure = () => {
          if (limitEnabled) rateLimit(loginKey, AUTH_RATE_LIMITS.login);
          return null;
        };

        if (!credentials?.username || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { username: credentials.username },
        });

        if (!user) return countFailure();

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return countFailure();

        // Clear accrued failures so a successful login can't be one mistake away
        // from a lockout, and a shared IP is drained by any legitimate sign-in.
        resetRateLimit(loginKey);

        return {
          id: user.id,
          name: user.displayName,
          username: user.username,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.id as string;
        (session.user as { username: string }).username = token.username as string;
        (session.user as { role: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    // Stateless JWT sessions: the session is a signed cookie (NEXTAUTH_SECRET),
    // with no server-side store — so restarting the app does NOT log users out
    // (see AGENTS.md "Session behavior"). maxAge is set explicitly to NextAuth's
    // 30-day default: long enough that weekly mobile users stay signed in between
    // picks, short enough that abandoned sessions expire. This is intentional.
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
};
