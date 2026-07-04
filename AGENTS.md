<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# GFL Survivor Pool

A custom NFL survivor pool web app built for Jackson's league. Replaces Splash Sports because it didn't support playoff point escalation or team trophies.

## Quick Start

```bash
docker compose up -d          # PostgreSQL on port 5433 (5432 is used by host PG)
pnpm seed                     # Minimal: admin user + 5 invite codes
pnpm seed:demo                # Full demo: 10 players, 3 teams, 3 weeks of data, week 4 upcoming
pnpm dev                      # http://localhost:3000
```

Demo credentials:
- Admin: `admin` / `admin123`
- All players: `password` (usernames: jdog, mike_t, sara_k, bigben, chadwick, tommy_b, lucky13, ace_v, queenb, zeke99)

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 16 (App Router) | TypeScript, Turbopack dev |
| Styling | Tailwind CSS v4 | Dark theme (gray-950 bg, white text) |
| Auth | NextAuth.js v4 | Credentials provider, JWT sessions |
| ORM | Prisma v7 | Requires `@prisma/adapter-pg` — PrismaClient needs `{ adapter }` constructor arg |
| DB | PostgreSQL 16 | Docker Compose, port 5433 (host 5432 already in use) |
| Seed scripts | tsx | `prisma/seed.ts` (minimal), `prisma/seed-demo.ts` (full demo data) |
| Package manager | pnpm v11 | `packageManager` field in package.json; settings in `pnpm-workspace.yaml` |
| Testing | Vitest | `pnpm test` to run, `pnpm test:watch` for watch mode |
| Email | nodemailer | SMTP via `SMTP_*` env; console fallback when unconfigured |

## Prisma v7 Gotchas

Prisma v7 has breaking changes from v5/v6:
- **No `url` in schema.prisma datasource block** — connection URL goes in `prisma.config.ts` only
- **PrismaClient requires an adapter**: `new PrismaClient({ adapter: new PrismaPg(connectionString) })`
- **Generated client output** is at `src/generated/prisma/client.ts` — import from `@/generated/prisma/client`
- **Seed scripts** need `import "dotenv/config"` at top since env vars aren't auto-loaded

## Deployment

Production is Docker: `Dockerfile` (multi-stage) + `docker-compose.prod.yml` (Postgres + one-shot `migrate` service + app + nginx). Full instructions in `DEPLOYMENT.md`. Non-obvious constraints learned building this:
- **Node 24** everywhere (`engines`/`.nvmrc`) — not the `node:20` you'll see in generic Next Docker guides.
- **Debian `bookworm-slim`, not Alpine** — the Prisma schema engine used by `migrate deploy` is the glibc/openssl3 build; Alpine (musl) would force a runtime engine download. `openssl` must be `apt-get install`ed (slim images omit it) or Prisma warns and misdetects libssl.
- **The app runner needs no Prisma engine** — the `@prisma/adapter-pg` driver adapter is pure JS, so the standalone runner stays slim (~390MB) and only the `migrator` stage carries the toolchain (~1.4GB).
- **Migrations run as a separate one-shot service**, not a per-replica entrypoint — the app waits on `depends_on: condition: service_completed_successfully`. This also sidesteps copying pnpm's symlinked store into the slim runner.
- **`NEXTAUTH_SECRET` fail-fast** lives in `src/instrumentation.ts` (`register()` runs once before serving); it throws in production if the secret is missing.

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Root redirect → /picks or /login
│   ├── layout.tsx                  # Root layout with SessionProvider
│   ├── providers.tsx               # Client-side NextAuth SessionProvider
│   ├── login/page.tsx              # Login form
│   ├── register/page.tsx           # Registration with invite code
│   ├── (app)/                      # Auth-protected route group
│   │   ├── layout.tsx              # Checks session, redirects if not logged in, renders Navbar
│   │   ├── picks/page.tsx          # Main pick page — week dropdown, team grid, pick history, live polling
│   │   ├── leaderboard/page.tsx    # Player standings + team trophy tab (respects pick visibility)
│   │   ├── settings/page.tsx       # Profile, password change, team management
│   │   └── admin/page.tsx          # Season creation, invite codes, schedule import, score sync (ADMIN only)
│   └── api/
│       ├── auth/[...nextauth]/     # NextAuth handler
│       ├── auth/register/          # POST — invite-gated registration
│       ├── auth/forgot-password/   # POST — request a reset link (no enumeration; emails if account has email)
│       ├── auth/reset-password/    # POST — consume token, set new password
│       ├── picks/                  # GET season+picks, POST submit/change pick
│       ├── leaderboard/            # GET player standings + team trophy (filters picks by visibility); ?seasonId= for history
│       ├── scores/sync/            # POST — fetch live scores from ESPN, update games, auto-grade picks
│       ├── settings/               # GET profile, PATCH update name/password
│       ├── teams/                  # GET list, POST create/join/leave
│       └── admin/
│           ├── import-schedule/    # POST — import NFL schedule from ESPN for a season week (admin only)
│           ├── invites/            # GET/POST invite codes (admin only)
│           ├── season/             # GET/POST seasons (admin only)
│           ├── users/              # GET user list (admin only)
│           └── reset-password/     # POST — admin generates a temp password for a user (last resort)
├── components/
│   └── navbar.tsx                  # Responsive nav with mobile hamburger menu
├── __tests__/
│   ├── nfl-teams.test.ts           # NFL team data integrity tests
│   ├── espn.test.ts                # ESPN API helper tests
│   └── pick-logic.test.ts          # Kickoff locking, visibility, grading, point values
└── lib/
    ├── auth.ts                     # NextAuth config (credentials provider, JWT callbacks)
    ├── mailer.ts                   # nodemailer transport from SMTP_* env; logs to console when unconfigured
    ├── password-reset.ts           # token gen/hash/expiry + temp password generation (pure, tested)
    ├── espn.ts                     # ESPN API helpers: team abbr mapping, URL builder, response types
    ├── types.ts                    # NextAuth session/JWT type augmentation
    ├── prisma.ts                   # Singleton PrismaClient with PrismaPg adapter
    └── nfl-teams.ts                # All 32 NFL teams with abbreviations, names, conference, division
```

## Data Model

```
User ──┬── Pick (one per user per week, unique on userId+weekId)
       ├── Team (optional, for team trophy)
       ├── InviteCode (used one to register)
       ├── InviteCode[] (created, if admin)
       ├── PasswordResetToken[] (single-use, hashed, 1h expiry)
       └── email (optional, unique; used for password reset)

Season ── Week[] ── Game[] (NFL games with scores/status)
                 └── Pick[] (all user picks for that week)

Team ── User[] (members, for team trophy standings)
```

## Game Rules (Implemented)

1. **One pick per week** — pick any NFL team playing that week
2. **No reuse** — once you pick a team, it's locked for the rest of the season
3. **Per-game kickoff locking** — teams lock at their game's kickoff time, NOT a single weekly deadline. If KC plays at noon and BUF plays at 3pm, you can still pick BUF after noon.
4. **Pick changes** — you can change your pick as long as your current pick's game AND the new pick's game haven't started
5. **No elimination** — wrong picks just miss points, you keep playing all season
6. **Regular season scoring** — 1 point per correct pick (weeks 1-18)
7. **Playoff scoring escalates**:
   - Wild Card (week 19): 2 points
   - Divisional (week 20): 3 points
   - Conference Championship (week 21): 4 points
   - Super Bowl (week 22): 5 points
8. **Team trophy** — players join teams; trophy based on average win percentage across team members. Players pick independently.

## Design Decisions

- **Dark theme** — gray-950/900/800 backgrounds, consistent across all pages
- **Mobile-first responsive** — hamburger nav, card layouts on mobile, tables on desktop
- **Week selector** — dropdown `<select>` with status indicators (checkmark=win, X=loss, bullet=pending)
- **Admin role** — only admins see the Admin nav link; API routes check `session.user.role === "ADMIN"`
- **Invite-only** — registration requires an invite code; admins generate them from the admin panel
- **Season creation** auto-generates all 22 weeks (18 regular + 4 playoff) with correct point values
- **Pick visibility** — other users' picks are hidden until the picked team's game kicks off. Admins see all picks. Users always see their own. This is enforced in the leaderboard API, not via a DB setting.
- **ESPN integration** — uses ESPN's public scoreboard API (`site.api.espn.com`). Team abbreviation mapping in `src/lib/espn.ts` (ESPN uses "WSH", we use "WAS"). Games are matched via `externalId` (ESPN event ID) stored on the Game model.
- **Live score polling** — picks page auto-polls every 30s when games are live/started. Calls `/api/scores/sync` (rate-limited to 1 call per 30s globally) then re-fetches picks data. The sync endpoint is accessible to any authenticated user.
- **Auto-grading** — when the score sync detects a game transition to FINAL, it determines the winner and sets all PENDING picks for that game to WIN/LOSS with points based on `week.pointValue`.
- **Password reset** — email is optional, set on the Settings page. `/forgot-password` requests a link (always returns success to avoid account enumeration; only sends if the account has an email). Tokens are random 32-byte hex, stored only as a SHA-256 hash, single-use, 1h expiry. `/reset-password?token=` consumes it. Email is sent via `lib/mailer.ts` (SMTP from `SMTP_*` env; logs the link to the console when SMTP is unconfigured). Admins have a last-resort reset in the admin panel that generates a temp password (returned once, never stored) to relay out of band.

## What's Done

- [x] Docker Compose + PostgreSQL
- [x] Prisma schema, migrations, generated client
- [x] NextAuth authentication (credentials, JWT, role-based)
- [x] Invite-only registration
- [x] Pick page with per-game kickoff locking
- [x] Leaderboard (player standings + team trophy)
- [x] Settings page (display name, password change, team management)
- [x] Admin panel (season creation, invite codes)
- [x] Mobile-responsive UI across all pages
- [x] Demo seed data (10 players, 3 teams, 3 completed weeks, 1 upcoming week)
- [x] Week selector changed to dropdown (was horizontal scrollable pills)
- [x] Pick visibility — other users' picks hidden until their game kicks off; admins see all
- [x] NFL schedule import — admin can import from ESPN by week or all at once
- [x] Live score syncing — fetches from ESPN, updates game scores/status in real time
- [x] Auto-grade picks — picks graded automatically when games go FINAL
- [x] Client-side live polling — picks page polls every 30s during active game windows
- [x] Vitest test suite — 58 tests covering NFL teams, ESPN helpers, pick locking, visibility, grading, reset tokens
- [x] Season history — leaderboard has a season selector to view any season's final standings + team trophy
- [x] Password reset — email-based self-service reset (nodemailer/SMTP, console fallback) with admin temp-password reset as last resort
- [x] pnpm migration — replaced npm with pnpm@11.5.2; settings in `pnpm-workspace.yaml`; `allowBuilds` whitelist blocks unapproved install scripts
- [x] Production deployment (#4) — multi-stage `Dockerfile` (Next standalone output), `docker-compose.prod.yml` (Postgres + one-shot `migrate` service + app + nginx), `NEXTAUTH_SECRET` fail-fast guard in `src/instrumentation.ts`. See `DEPLOYMENT.md`.

## What Still Needs to Be Done

- [ ] **Notifications** — remind users to make their pick before kickoff via email. Tracked in #27: regular season gets two reminders (before Thursday night kickoff, before the first Sunday kickoff) sent only to users without a pick yet; playoff weeks (19-22) collapse to a single morning-of reminder for the week's first game.
- [ ] **Tie handling** — score sync currently picks the home team as winner on ties. NFL regular season games can't tie (overtime rules), but worth verifying edge cases.
- [ ] **Pre-existing auth.ts type errors** — `src/lib/auth.ts` has TS errors on lines 39-40 (casting `User | AdapterUser` to `{ username }` / `{ role }`). Works at runtime but fails `tsc --noEmit`. Should add proper type narrowing.
- [ ] **Leaderboard polish** — #22 missing `key` prop on expanded player rows (shorthand fragment can't carry one — use `Fragment` from `react`); #24 add a `realName` field shown alongside username; #25 redesign the expanded pick history as a table and drop the `+N` point indicator.
- [ ] **CI security scanning** — #26: add dependency vulnerability scanning (osv-scanner/npm audit) and consider CodeQL/secret scanning to `.github/workflows/ci.yml`, alongside the existing lint/test/build job.
- [ ] **Mobile testing support** — #28: make the dev server reachable from real devices on the LAN for manual testing (verify `NEXTAUTH_URL`/cookies work from a non-localhost origin); #29: add automated E2E testing (Playwright) covering golden-path flows plus a mobile-viewport suite.
- [ ] **Session behavior documentation** — #23: JWT sessions persist across app restarts by design (stateless, signed with `NEXTAUTH_SECRET` from `.env`); document this so it isn't mistaken for a bug, and decide whether to set an explicit `session.maxAge`.

## Testing

Tests use **Vitest** with native tsconfig path resolution. Run with `pnpm test` or `pnpm test:watch`.

```
src/__tests__/
├── nfl-teams.test.ts       # NFL team data integrity, getTeamName lookup
├── espn.test.ts            # ESPN abbreviation mapping, week params, URL builder
├── pick-logic.test.ts      # Per-game kickoff locking, pick visibility rules, auto-grading, point values
└── password-reset.test.ts  # Reset token gen/hash/expiry, temp password generation
```

Tests cover the core business logic extracted from API routes: kickoff locking, pick visibility (own picks always visible, admin sees all, others hidden until kickoff), grading (WIN/LOSS determination), and playoff point escalation. API routes themselves are not directly tested (they depend on Prisma/NextAuth) — consider integration tests with a test database for that layer.
