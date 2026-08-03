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

Real-device mobile testing over the LAN (`pnpm dev:lan`) is covered by the **`mobile-lan-testing`** skill.

## Prisma v7 Gotchas

Prisma v7 has breaking changes from v5/v6:
- **No `url` in schema.prisma datasource block** — connection URL goes in `prisma.config.ts` only
- **PrismaClient requires an adapter**: `new PrismaClient({ adapter: new PrismaPg(connectionString) })`
- **Generated client output** is at `src/generated/prisma/client.ts` — import from `@/generated/prisma/client`
- **Seed scripts** need `import "dotenv/config"` at top since env vars aren't auto-loaded

## Deployment

Production is Docker: `Dockerfile` + `docker-compose.prod.yml` (Postgres + one-shot `migrate` service + app + nginx + backup/certbot/reminders sidecars). Full instructions in `DEPLOYMENT.md`; the non-obvious constraints learned building it are in the **`deployment-notes`** skill.

## Project Structure

```
src/
└── lib/
    ├── auth.ts                     # NextAuth config (credentials provider, JWT callbacks)
    ├── mailer.ts                   # nodemailer transport from SMTP_* env; logs to console when unconfigured
    ├── password-reset.ts           # token gen/hash/expiry + temp password generation (pure, tested)
    ├── reminders.ts                 # pure reminder scheduling: slot computation, due window, email body (tested)
    ├── espn.ts                     # ESPN API helpers: team abbr mapping, URL builder, response types
    ├── stadiums.ts                 # 32 NFL stadiums: lat/lon + indoor flag (dome/retractable) — for weather (tested)
    ├── weather.ts                  # pure Open-Meteo helpers: URL builder, forecast parse, cache staleness, display format (tested)
    ├── odds.ts                     # pure The-Odds-API helpers: URL builder, spread parse/median, refresh gate, display format (tested)
    ├── odds-sync.ts                # server-side bulk-odds fetch + persist to Game.spreadHome (imports prisma; wired into sync + import-schedule)
    ├── types.ts                    # NextAuth session/JWT type augmentation
    ├── prisma.ts                   # Singleton PrismaClient with PrismaPg adapter
    ├── teams.ts                    # pure team-name validation (trim/blank/collision/self-rename); route delegates to it (tested)
    ├── invites.ts                  # pure invite logic: human-friendly league code gen + checkInviteUsable (single vs multi-use, cap, disable, expiry); register + admin routes delegate (tested)
    ├── rosters.ts                  # pure season-scoped roster logic: rostersLocked (first-kickoff lock), computeRolloverMemberships (new-season copy), buildTeamStandings (season-keyed trophy grouping) — #120 (tested)
    ├── datetime.ts                 # pure formatKickoff — date+time with a timezone label; shared by picks UI + reminder emails (tested)
    └── nfl-teams.ts                # All 32 NFL teams with abbreviations, names, conference, division
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

- **Dark theme** — gray-950/900/800 backgrounds, consistent across all pages. **Dark-only, locked in the root layout** (`bg-gray-950 text-white` on `<body>`) — this is the single source of truth. Do *not* reintroduce a `prefers-color-scheme`-driven `body { background }` in `globals.css`: it's un-layered, so it overrides Tailwind v4's layered utilities and turns the whole app white in light-mode browsers.
- **Motion / design system** (#12) — Tailwind-only, no external animation library. Custom keyframes (`fade-in`, `fade-in-up`, `pop`) are registered as `animate-*` utilities in `globals.css` and are **transform/opacity-only** (GPU compositor, no layout/paint); skeleton loaders reuse the built-in `animate-pulse`. Everything is disabled under `prefers-reduced-motion` via a global override in `globals.css`, so motion never costs low-end/mobile devices. Route-change fade lives in `(app)/template.tsx` (a template re-mounts on navigation, replaying its mount animation below the persistent Navbar). Cards are flat-dark `border-white/10 bg-white/5`; shared auth input/button classes live in `src/lib/ui.ts` so login/register match the in-app style. The picks page does an **optimistic** pick update (instant reflect, rollback on error) with a `pop` on the current-pick card.
- **Mobile-first responsive** — hamburger nav, card layouts on mobile, tables on desktop
- **Week selector** — dropdown `<select>` with status indicators (checkmark=win, X=loss, bullet=pending)
- **Admin role** — only admins see the Admin nav link; API routes check `session.user.role === "ADMIN"`
- **Invite-only** — registration requires an invite code; admins generate them from the admin panel
- **Pick visibility** — other users' picks are hidden until the picked team's game kicks off. Admins see all picks. Users always see their own. This is enforced in the leaderboard API, not via a DB setting. The leaderboard's "Show Picks" toggle only controls client-side display of the already-visibility-filtered picks; it can't reveal anything the API withheld.

Per-feature design rationale (invites #110/#111/#112/#126, season-scoped rosters #120, ESPN sync, weather #16, betting spreads #17, auth rate limiting, password reset, pick reminders, JWT sessions #23, accessibility #54, kickoff formatting #90) lives in the **`design-decisions`** skill — it loads on demand when you work on those features.

## Workflow

- **Open follow-up tickets for known gaps.** When finishing a task, note any
  out-of-scope work you came across (deferred hardening, TODOs, edge cases, gaps
  the change exposes). **After the PR is created**, open a GitHub issue for each —
  with a description, acceptance criteria, and implementation hints — and note it
  was split out of the parent issue. Link them where the gap is documented (e.g. a
  "Known gaps" list in the relevant doc) so they're traceable rather than lost in
  the PR discussion. See #4 → #40/#41/#42/#43 for the pattern.

## Testing

Tests use **Vitest** with native tsconfig path resolution. Run with `pnpm test` or `pnpm test:watch`.

```
src/__tests__/
├── nfl-teams.test.ts       # NFL team data integrity, getTeamName lookup
├── espn.test.ts            # ESPN abbreviation mapping, week params, URL builder
├── pick-logic.test.ts      # Per-game kickoff locking, pick visibility rules, auto-grading, point values
├── password-reset.test.ts  # Reset token gen/hash/expiry, temp password generation
├── reminders.test.ts       # Reminder slots (Thu/Sun/playoff), timezone weekday, due window, recipient filter
├── stadiums.test.ts        # Stadium table integrity, exact indoor set (SEA outdoor regression) — src/lib/stadiums.ts
├── weather.test.ts         # Open-Meteo URL/parse, cache staleness, compass/icon/format — src/lib/weather.ts
├── odds.test.ts            # Odds-API URL/parse, median spread, refresh gate, spread display format — src/lib/odds.ts
├── teams.test.ts           # Team name validation (trim, blank, collision, self-rename) — src/lib/teams.ts
├── rosters.test.ts         # Season-scoped rosters: lock, rollover (skip deleted team/user), trophy grouping incl. cross-season + teamless — src/lib/rosters.ts (#120)
├── invites.test.ts         # League code gen + checkInviteUsable (single/multi-use, cap, disable, expiry), normalizeMaxUses — src/lib/invites.ts
├── datetime.test.ts        # formatKickoff zone/label output across timezones — src/lib/datetime.ts
├── register.test.ts        # deriveProfileNames (#112) + deriveSettingsProfile/splitRealName round-trip (#126) — src/lib/register.ts
└── espn-replay.test.ts     # Replays real 2024 ESPN fixtures through the parser + grader (#109) — see below

DB-backed (gated on SIM_DATABASE_URL, skipped by a plain `pnpm test`):
├── sim-season.integration.test.ts    # Full 22-week season through the real schema + grader (#108)
└── invite-claim.integration.test.ts  # Concurrent registrations can't exceed a league code's maxUses (#123)
```

These cover the core business logic extracted from API routes: kickoff locking, pick visibility (own picks always visible, admin sees all, others hidden until kickoff), grading (WIN/LOSS determination), playoff point escalation, and team-name validation.

**When you add or change logic, extract it to a `lib/` helper and unit-test it in the same change — don't leave it inline in the route and don't defer coverage to a follow-up ticket.** API routes aren't unit-tested directly (they depend on Prisma/NextAuth); the E2E suite exercises them through the UI instead.

Deep dives on the DB-backed season simulator (#108), the invite-cap concurrency test (#123), ESPN fixture replay (#109), and the Playwright E2E suite live in the **`testing-guide`** skill.
