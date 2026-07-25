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

### Testing on a real mobile device (same Wi-Fi)

The UI is mobile-first; to test layouts on an actual phone rather than devtools emulation, run the dev server bound to all interfaces so it's reachable over the LAN:

```bash
pnpm dev:lan                  # next dev --turbopack -H 0.0.0.0
```

Then, from a phone on the **same Wi-Fi**, open `http://<your-LAN-IP>:3000`. Find the IP with:
- Linux: `hostname -I` (first address) · macOS: `ipconfig getifaddr en0` · Windows: `ipconfig` → IPv4 Address

Next's startup banner prints `Network: http://0.0.0.0:3000` (it doesn't resolve the actual IP for you), so use the address from the command above. (#77 tracks printing the resolved LAN URL automatically.)

**Cross-origin dev assets** — Next 16 blocks its dev-only assets (HMR, client JS chunks) from any origin other than `localhost` by default. Loaded from a LAN IP without allowlisting it, **the page HTML renders but the client never hydrates** — and the login form then silently falls back to a native `GET /login?username=…&password=…` (the `onSubmit`/`signIn()` handler never runs), so sign-in appears to "do nothing." `next.config.ts` allowlists the common private ranges via `allowedDevOrigins: ["192.168.*.*", "10.*.*.*"]` (dev-only; no effect on production builds), so `pnpm dev:lan` works out of the box on a typical home network. If your Wi-Fi hands out a different range (e.g. `172.x`), add it there. Next's matcher is per-segment, so `*` matches exactly one segment.

**Login works over the LAN IP with no env changes** — leave `NEXTAUTH_URL="http://localhost:3000"`. Verified empirically: sign-in uses `signIn(..., redirect: false)` + a client-side `router.push`, and the session cookie is host-scoped and non-`Secure` over plain http, so signing in from `http://192.168.x.x:3000` sets the cookie correctly and `/api/auth/session` returns the user. `NEXTAUTH_URL` only affects **absolute** URLs. Known caveats that resolve against it (and so point at `localhost`): password-reset and reminder **email links**. (Logout used to have this bug too — `signOut({ callbackUrl })` returned an absolute URL and redirected to `localhost/login`; fixed in #78 by mirroring login's `signOut({ redirect: false })` + client-side `router.push("/login")` in `src/components/navbar.tsx`, so logout now stays on the loaded origin.) For layout testing this is harmless; to exercise the email links from the phone, temporarily set `NEXTAUTH_URL` to the LAN IP.

Gotchas: your OS/router firewall must allow inbound `:3000` on the LAN; some networks (guest Wi-Fi, "AP isolation") block device-to-device traffic. Docker/Postgres needs no change — the phone talks to Next.js, which talks to the DB on the host.

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

Production is Docker: `Dockerfile` (multi-stage) + `docker-compose.prod.yml` (Postgres + one-shot `migrate` service + app + nginx + `backup`/`certbot`/`reminders` sidecars). Full instructions in `DEPLOYMENT.md`. Non-obvious constraints learned building this:
- **Node 24** everywhere (`engines`/`.nvmrc`) — not the `node:20` you'll see in generic Next Docker guides.
- **Debian `bookworm-slim`, not Alpine** — the Prisma schema engine used by `migrate deploy` is the glibc/openssl3 build; Alpine (musl) would force a runtime engine download. `openssl` must be `apt-get install`ed (slim images omit it) or Prisma warns and misdetects libssl.
- **The app runner needs no Prisma engine** — the `@prisma/adapter-pg` driver adapter is pure JS, so the standalone runner stays slim (~390MB) and only the `migrator` stage carries the toolchain (~1.4GB).
- **Migrations run as a separate one-shot service**, not a per-replica entrypoint — the app waits on `depends_on: condition: service_completed_successfully`. This also sidesteps copying pnpm's symlinked store into the slim runner.
- **`NEXTAUTH_SECRET` fail-fast** lives in `src/instrumentation.ts` (`register()` runs once before serving); it throws in production if the secret is missing.
- **TLS terminates at nginx** (#40) — `deploy/nginx.conf.template` (an nginx *template*; the image `envsubst`s only `${DOMAIN}`, gated by `NGINX_ENVSUBST_FILTER=DOMAIN`, so `$host`/`$scheme` survive) redirects `:80`→HTTPS and terminates TLS 1.2/1.3 on `:443` with HSTS. Certs come from a `certbot` companion container (Let's Encrypt webroot challenge) in the shared `certbot_certs`/`certbot_www` volumes; it renews every 12h and nginx reloads every 6h — no manual step. First cert is bootstrapped once with `deploy/init-letsencrypt.sh` (dummy self-signed cert → start nginx → swap in the real cert), which resolves the nginx-needs-a-cert-to-start vs. webroot-needs-nginx chicken-and-egg. Set `NEXTAUTH_URL=https://…` so NextAuth issues Secure cookies. See `DEPLOYMENT.md` → TLS.

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
│   │   ├── settings/page.tsx       # Profile (display/real name, email, reminders), password change
│   │   └── admin/page.tsx          # Season creation, invite codes, schedule import, score sync (ADMIN only)
│   └── api/
│       ├── health/                 # GET — unauthenticated readiness probe (SELECT 1); Docker healthcheck gates nginx on it
│       ├── auth/[...nextauth]/     # NextAuth handler
│       ├── auth/register/          # POST — invite-gated registration
│       ├── auth/forgot-password/   # POST — request a reset link (no enumeration; emails if account has email)
│       ├── auth/reset-password/    # POST — consume token, set new password
│       ├── picks/                  # GET season+picks, POST submit/change pick
│       ├── leaderboard/            # GET player standings + team trophy (filters picks by visibility); ?seasonId= for history
│       ├── scores/sync/            # POST — fetch live scores from ESPN, update games, auto-grade picks, refresh weather + betting spreads
│       ├── settings/               # GET profile, PATCH update name/password
│       ├── teams/                  # GET list, POST create/join/leave
│       └── admin/
│           ├── import-schedule/    # POST — import NFL schedule from ESPN for a season week + prime betting spreads (admin only)
│           ├── invites/            # GET/POST invite codes (admin only)
│           ├── season/             # GET/POST seasons (admin only)
│           ├── users/              # GET user list (admin only)
│           ├── reset-password/     # POST — admin generates a temp password for a user (last resort)
│           └── reminders/send/     # POST — cron-triggered pick reminders (Bearer CRON_SECRET, not session)
├── components/
│   └── navbar.tsx                  # Responsive nav with mobile hamburger menu
├── __tests__/
│   ├── nfl-teams.test.ts           # NFL team data integrity tests
│   ├── espn.test.ts                # ESPN API helper tests
│   ├── pick-logic.test.ts          # Kickoff locking, visibility, grading, point values
│   └── reminders.test.ts           # Reminder slot scheduling (Thu/Sun/playoff), due window, recipient filter
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
    └── nfl-teams.ts                # All 32 NFL teams with abbreviations, names, conference, division
```

## Data Model

```
User ──┬── Pick (one per user per week, unique on userId+weekId)
       ├── Team (optional, for team trophy)
       ├── InviteCode (used one to register)
       ├── InviteCode[] (created, if admin)
       ├── PasswordResetToken[] (single-use, hashed, 1h expiry)
       ├── ReminderLog[] (one per user+week+slot; idempotency ledger for pick reminders)
       ├── email (optional, unique; used for password reset + reminders)
       └── emailReminders (bool, default true; opt-out toggle in Settings)

Season ── Week[] ── Game[] (NFL games with scores/status + cached weatherJson + spreadHome)
                 ├── Pick[] (all user picks for that week)
                 └── ReminderLog[] (reminders sent for that week)

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

- **Dark theme** — gray-950/900/800 backgrounds, consistent across all pages. **Dark-only, locked in the root layout** (`bg-gray-950 text-white` on `<body>`) — this is the single source of truth. Do *not* reintroduce a `prefers-color-scheme`-driven `body { background }` in `globals.css`: it's un-layered, so it overrides Tailwind v4's layered utilities and turns the whole app white in light-mode browsers.
- **Motion / design system** (#12) — Tailwind-only, no external animation library. Custom keyframes (`fade-in`, `fade-in-up`, `pop`) are registered as `animate-*` utilities in `globals.css` and are **transform/opacity-only** (GPU compositor, no layout/paint); skeleton loaders reuse the built-in `animate-pulse`. Everything is disabled under `prefers-reduced-motion` via a global override in `globals.css`, so motion never costs low-end/mobile devices. Route-change fade lives in `(app)/template.tsx` (a template re-mounts on navigation, replaying its mount animation below the persistent Navbar). Cards are flat-dark `border-white/10 bg-white/5`; shared auth input/button classes live in `src/lib/ui.ts` so login/register match the in-app style. The picks page does an **optimistic** pick update (instant reflect, rollback on error) with a `pop` on the current-pick card.
- **Toasts / notices** (#53) — transient success/error feedback goes through a shared `ToastProvider` + `useToast()` (`src/components/toast.tsx`), mounted in `src/app/providers.tsx` alongside `SessionProvider`. No external toast library — a small context + Tailwind. Toasts render in a `fixed` bottom overlay (`pointer-events-none` container, `pointer-events-auto` items) so they **never shift page layout**; each auto-dismisses (`AUTO_DISMISS_MS`, 4s) and is manually dismissible. Enter uses `animate-fade-in-up`, exit a `translate-y/opacity` transition — both collapse to near-instant under `prefers-reduced-motion` via the global override. Adopted on picks (pick submit), settings (profile save + password change), and admin team actions (create/rename/delete/assign/unassign). **Kept as inline persistent panels, not toasts:** reference output the user needs to read/copy — admin temp-password, invite code, import log, sync result. Note for E2E: some specs assert on broad `text=` matchers (e.g. `text=2026` for season create); don't route those values through a toast or you'll trip Playwright strict-mode (two matches). The picks E2E relies on the `Picked <team>` toast text, so keep that string stable.
- **Mobile-first responsive** — hamburger nav, card layouts on mobile, tables on desktop
- **Week selector** — dropdown `<select>` with status indicators (checkmark=win, X=loss, bullet=pending)
- **Admin role** — only admins see the Admin nav link; API routes check `session.user.role === "ADMIN"`
- **Invite-only** — registration requires an invite code; admins generate them from the admin panel
- **Season creation** auto-generates all 22 weeks (18 regular + 4 playoff) with correct point values
- **Pick visibility** — other users' picks are hidden until the picked team's game kicks off. Admins see all picks. Users always see their own. This is enforced in the leaderboard API, not via a DB setting. The leaderboard's "Show Picks" toggle only controls client-side display of the already-visibility-filtered picks; it can't reveal anything the API withheld.
- **Persisted client toggles** — client-only UI state that should survive navigation within a session (e.g. the leaderboard "Show Picks" toggle) is persisted in `localStorage` via a `useSyncExternalStore`-backed helper (see `usePersistedToggle` in `leaderboard/page.tsx`). Use `useSyncExternalStore` (server snapshot returns the default) rather than reading `localStorage` in a `useEffect` + `setState` — the latter trips the `react-hooks/set-state-in-effect` lint rule and risks an SSR/client hydration mismatch.
- **ESPN integration** — uses ESPN's public scoreboard API (`site.api.espn.com`). Team abbreviation mapping in `src/lib/espn.ts` (ESPN uses "WSH", we use "WAS"). Games are matched via `externalId` (ESPN event ID) stored on the Game model.
- **Live score polling** — picks page auto-polls every 30s when games are live/started. Calls `/api/scores/sync` (rate-limited to 1 call per 30s globally) then re-fetches picks data. The sync endpoint is accessible to any authenticated user.
- **Auto-grading** — when the score sync detects a game transition to FINAL, it determines the winner and sets all PENDING picks for that game to WIN/LOSS with points based on `week.pointValue`.
- **Game-day weather** (#16) — outdoor matchup cards show a forecast (`☁ 41°F · Wind 22mph NW · 70% precip`); indoor stadiums show a `🏟️ Dome` symbol instead (never blank). Source is [Open-Meteo](https://open-meteo.com/) (free, no key). Stadium coords + indoor flag are a static table in `src/lib/stadiums.ts` — **retractable roofs (ARI, ATL, DAL, HOU, IND) and fixed roofs (SoFi = LAR/LAC, DET, LV, MIN, NO) count as indoor**; SEA (Lumen) and MetLife (NYG/NYJ) are **open-air** (the ticket's "SEA retractable" was wrong — Lumen only roofs the seats). Forecasts are fetched in the score-sync route for outdoor games within 72h of kickoff, cached in `Game.weatherJson` and refreshed at most every ~3h (`shouldFetchWeather`), so it's not re-fetched on every poll. Fetch failures are swallowed per-game (`Promise.allSettled`) so weather never breaks score sync or blanks a card. The picks page fires one sync on mount so weather populates before kickoff (ESPN stays rate-limited, weather stays cache-gated). Pure logic (URL build, forecast parse, staleness, compass/icon/format) lives in `src/lib/weather.ts` and is unit-tested; the dome indicator is derived client-side from the stadium table, so it needs no DB round-trip.
- **Betting spread** (#17) — each matchup card shows the Vegas point spread under each team (favorite `-6.5`, underdog `+6.5`, `PK` for pick'em); absent (nothing shown) when odds aren't available or `ODDS_API_KEY` is unset, so the feature **degrades gracefully**. Source is [The Odds API](https://the-odds-api.com/) (free tier 500 req/month). Unlike weather (per-stadium), the NFL odds endpoint returns **every** upcoming game in one call, so we make a single **bulk** fetch and match each game by full team name (`getTeamName`), taking the **median** home spread across US bookmakers. Stored on `Game.spreadHome` (Float?, negative = home favored; the away spread is always the inverse) so the picks page never makes a live odds call. The fetch lives in `src/lib/odds-sync.ts` (`refreshOddsForGames`, imports Prisma) and is wired into **both** the score-sync route and admin import-schedule. It's gated by a **shared module-level `lastOddsFetch`** timestamp refreshing at most every ~6h (`ODDS_REFRESH_MS`) — same single-instance tradeoff as the score-sync cooldown — and only prices games within 7 days of kickoff and not yet started (`gameNeedsOdds`); this keeps well within the 500/month quota. Failures are swallowed (`Promise.allSettled` + try/catch) so odds never break score sync or schedule import. The spread is hidden client-side once a game is FINAL (it's pre-game context). Pure logic (URL build, spread parse/median, refresh gate, `formatSpread`) lives in `src/lib/odds.ts` and is unit-tested.
- **Auth rate limiting** — rate-limited by client IP; in-memory fixed-window store in `src/lib/rate-limit.ts` (single-instance only; resets on restart, not shared across replicas — a shared store for horizontal scaling is tracked in #87, alongside the same limitation in #73). Two enforcement points:
  - `src/proxy.ts` limits forgot-password (5/15min) and reset-password (10/hour) — over-limit → `429` with `Retry-After`. Note: **Next 16 renamed the `middleware` file convention to `proxy`** (`proxy.ts`, exports `proxy()` + `config.matcher`; defaults to the Node.js runtime) — `middleware.ts` is deprecated.
  - **Login (10/15min) is enforced in the `authorize` callback** (`src/lib/auth.ts`), *not* the proxy (#46). The proxy runs in a separate module context and can't see the auth result, so it can only count *every* POST (successes included) — the bug #46 fixed. In `authorize` we count **failed attempts only**: a successful login never consumes budget and **resets** the window (so a fat-fingered password or a shared/NAT'd IP isn't penalised by normal use). Over the limit, `authorize` returns `null` → a **401 indistinguishable from a wrong password** (no `429`), which both engages a real per-IP lockout — even a correct password is rejected until the window clears — and avoids advertising the control (the reasoning behind closing #45). Keyed per-IP (not per-username) to avoid a lockout-DoS on a victim. Honors the same `RATE_LIMIT_DISABLED=true` E2E escape hatch as the proxy.
  - Client IP comes from `X-Forwarded-For`/`X-Real-IP`, set by nginx (`deploy/nginx.conf.template`); `getClientIp` in `rate-limit.ts` reads both a `Headers` instance (proxy) and a plain header object (the `authorize` `req`).
- **Password reset** — email is optional, set on the Settings page. `/forgot-password` requests a link (always returns success to avoid account enumeration; only sends if the account has an email). Tokens are random 32-byte hex, stored only as a SHA-256 hash, single-use, 1h expiry. `/reset-password?token=` consumes it. Email is sent via `lib/mailer.ts` (SMTP from `SMTP_*` env; logs the link to the console when SMTP is unconfigured). Admins have a last-resort reset in the admin panel that generates a temp password (returned once, never stored) to relay out of band.
- **Pick reminders** — email nudges to users who still have no pick, sent by a scheduler hitting an endpoint (no in-app cron). `POST /api/admin/reminders/send` is authenticated by a `CRON_SECRET` bearer token (constant-time compared), *not* a session, so it can be called by system cron / a hosted scheduler. In prod, a bundled **`reminders` sidecar** (#51, `deploy/reminders.sh`, reuses the app image — no new dependency) polls it every `REMINDER_INTERVAL`s (default 900) over the internal Compose network (`http://app:3000`, so `CRON_SECRET` never leaves the private net); it **idles** (no crash-loop) when `CRON_SECRET` is unset so the stack still comes up. Note the app service must also carry `CRON_SECRET` in its env or the endpoint 503s. It resolves the current week (earliest week with a game still to kick off), computes which reminder *slots* are due, and emails opted-in users without a pick. Slot schedule (`src/lib/reminders.ts`, pure + tested): regular season = a **Thursday** slot (~3h before the Thursday-night game) and a **Sunday** slot (~3h before the earliest Sunday game), each skipped if that day has no game; playoffs = a single **morning-of** slot (9am ET on the first game's day, since playoff weekends can start Saturday). Weekday is computed in `America/New_York` — a Thursday-night kickoff is already Friday in UTC, so a naive UTC weekday would misclassify it. Idempotency + delivery tracking (#49): each `ReminderLog` row (unique per user+week+slot) carries a `status` (`ReminderStatus`: `PENDING`/`SENT`/`FAILED`). The row is **claimed as `PENDING` before sending** (unique-constraint conflict → a concurrent run has it, skip), then flipped to `SENT` when `sendMail()` returns (**the console fallback counts as sent** — `{ delivered: false }` isn't a failure) or to `FAILED` if it *throws*. The recipient query excludes only `PENDING`/`SENT` rows (`HANDLED_REMINDER_STATUSES`, the single source of truth exported from `reminders.ts`), so a `FAILED` send is **re-selected and retried on the next run** — a transient SMTP hiccup no longer permanently suppresses a reminder. Retry re-claims a `FAILED` row atomically (`updateMany … where status:'FAILED' → 'PENDING'`; count 0 = another run took it, skip), so overlapping runs still never double-email. Known edge: a crash *between* claim and outcome leaves a stuck `PENDING` (not retried) — rare, tracked in #89 (reclaim stale `PENDING` rows past a staleness cutoff). Lead time is tunable via `REMINDER_LEAD_HOURS`. Reuses `lib/mailer.ts` (console fallback when SMTP is unconfigured). See the "Pick reminders (cron)" section in `DEPLOYMENT.md`.
- **Session behavior** (#23) — auth uses **stateless JWT sessions** (`src/lib/auth.ts`, `session.strategy: "jwt"`), *not* database-backed sessions. The session is a signed cookie (signed with `NEXTAUTH_SECRET` from `.env`); there is no server-side session store. **Consequence: restarting the app (dev server or `docker compose down/up`) does NOT log users out** — the JWT is self-contained and keeps validating as long as `NEXTAUTH_SECRET` is unchanged. This is **by design**, the standard JWT-vs-DB-session tradeoff (redeploys don't sign users out), not a bug. `maxAge` is set **explicitly** to NextAuth's 30-day default (`30 * 24 * 60 * 60`): long enough that weekly mobile users stay signed in between picks, short enough that abandoned sessions expire — decided against a shorter window to avoid nagging re-logins. Rotating `NEXTAUTH_SECRET` invalidates all existing sessions (the only server-side "log everyone out" lever); switching to DB sessions (Prisma adapter) would let a restart invalidate sessions but is a much bigger change and not worth it here.
- **Accessibility** (#54) — the picks + leaderboard interactive UI carries explicit a11y semantics, so status is never color/glyph-alone and everything works with a keyboard/screen reader. A **shared focus ring** lives in `src/lib/ui.ts` (`focusRing` with a gray-950 offset; `focusRingInset` for controls inside an `overflow-hidden` container like the split matchup buttons) — `focus-visible` so it only shows for keyboard/AT users. Picks page: the week `<select>` badges are **words** (`— Won/Lost/Picked`, not bare `✓/✗/•`) since `<option>`s can't hold `sr-only` markup; team buttons expose `aria-pressed` + an `aria-label` that **keeps the abbr first** (`"SF San Francisco 49ers, your pick"` — the E2E suite selects buttons by abbr, so the abbr must stay in the accessible name); the "Season picks" collapsible has `aria-expanded`/`aria-controls` with an `aria-hidden` chevron; a visually-hidden `role="status" aria-live="polite"` region announces live/final score changes (the string only changes when a score/status does, so silent polls stay silent). Leaderboard: the Players/Team-Trophy tabs are a real `role="tablist"` with roving `tabindex` + Arrow-key nav + `aria-selected`/`aria-controls`, panels are `role="tabpanel"`; Show/Hide Picks is `aria-pressed`; expandable player rows are keyboard-activatable (`role="button"`, `tabIndex`, Enter/Space, `aria-expanded`); the per-pick result glyph gets an `sr-only` word (`Win/Loss/Pending`) with the glyph `aria-hidden`. Verified with axe (0 serious/critical violations from the semantics) + the desktop E2E suite. **Known gap:** app-wide muted-text **color contrast** (`text-gray-500`/`gray-600` on `gray-950`) is below WCAG AA — pre-existing and a visual-restyle concern (pairs with the #12 design system), tracked in #96, deliberately out of scope for this semantics pass.

## Workflow

- **Open follow-up tickets for known gaps.** When finishing a task, note any
  out-of-scope work you came across (deferred hardening, TODOs, edge cases, gaps
  the change exposes). **After the PR is created**, open a GitHub issue for each —
  with a description, acceptance criteria, and implementation hints — and note it
  was split out of the parent issue. Link them where the gap is documented (e.g. a
  "Known gaps" list in the relevant doc) so they're traceable rather than lost in
  the PR discussion. See #4 → #40/#41/#42/#43 for the pattern.

## What's Done

- [x] Docker Compose + PostgreSQL
- [x] Prisma schema, migrations, generated client
- [x] NextAuth authentication (credentials, JWT, role-based)
- [x] Invite-only registration
- [x] Pick page with per-game kickoff locking
- [x] Leaderboard (player standings + team trophy)
- [x] Settings page (display name, real name, email, reminders, password change; team management is admin-only)
- [x] Admin panel (season creation, invite codes)
- [x] Mobile-responsive UI across all pages
- [x] Real-device mobile testing (#28) — `pnpm dev:lan` binds `0.0.0.0` so a phone on the same Wi-Fi can load the app; auth verified working over a LAN IP with the default `NEXTAUTH_URL`. See "Testing on a real mobile device" in Quick Start.
- [x] Demo seed data (10 players, 3 teams, 3 completed weeks, 1 upcoming week)
- [x] Week selector changed to dropdown (was horizontal scrollable pills)
- [x] Pick visibility — other users' picks hidden until their game kicks off; admins see all
- [x] NFL schedule import — admin can import from ESPN by week or all at once
- [x] Live score syncing — fetches from ESPN, updates game scores/status in real time
- [x] Game-day weather (#16) — Open-Meteo forecast on outdoor matchup cards, `🏟️ Dome` for indoor; cached in `Game.weatherJson`, refreshed in the score-sync route (corrected SEA to open-air)
- [x] Betting spread (#17) — The Odds API consensus (median) spread under each team on matchup cards; cached in `Game.spreadHome`, bulk-fetched + 6h-gated in `src/lib/odds-sync.ts` (wired into score-sync + import-schedule), degrades gracefully without `ODDS_API_KEY`
- [x] Auto-grade picks — picks graded automatically when games go FINAL
- [x] Client-side live polling — picks page polls every 30s during active game windows
- [x] Vitest test suite — unit tests for pure logic extracted to `lib/` (NFL teams, ESPN, pick locking/visibility/grading, reset tokens, reminders, team-name validation)
- [x] Playwright E2E suite (#29) — `e2e/` drives the real UI (auth, picks, leaderboard, admin, password reset) across `desktop` + `mobile` (iPhone 14) projects; own throwaway `gfl_e2e` DB seeded per run
- [x] Season history — leaderboard has a season selector to view any season's final standings + team trophy
- [x] Password reset — email-based self-service reset (nodemailer/SMTP, console fallback) with admin temp-password reset as last resort
- [x] pnpm migration — replaced npm with pnpm@11.5.2; settings in `pnpm-workspace.yaml`; `allowBuilds` whitelist blocks unapproved install scripts
- [x] Auth rate limiting (#5) — in-memory fixed-window limiter (`src/lib/rate-limit.ts`). Proxy limits forgot-password/reset-password (`429` + `Retry-After`); login is limited in the `authorize` callback, counting failed attempts only (#46), returning a 401 lockout rather than a 429. Follow-up #45 (distinct login 429 message) closed won't-fix — the 401 lockout deliberately doesn't advertise itself. Follow-up #87: make the limiter multi-instance safe (shared store).
- [x] Pick reminders (#7/#27) — cron-triggered email nudges to users without a pick. `POST /api/admin/reminders/send` (Bearer `CRON_SECRET`), phase-aware slots (regular: Thu + first Sunday; playoff: morning-of), opt-out toggle in Settings, idempotent per (user, week, slot) via `ReminderLog`. Logic in `src/lib/reminders.ts`.
- [x] Production deployment (#4) — multi-stage `Dockerfile` (Next standalone output), `docker-compose.prod.yml` (Postgres + one-shot `migrate` service + app + nginx), `NEXTAUTH_SECRET` fail-fast guard in `src/instrumentation.ts`. See `DEPLOYMENT.md`.
- [x] Leaderboard picks toggle (#10) — "Show Picks" toggle (off by default) reveals every player's weekly picks at once; also supports per-row click-to-expand. State persists across navigation via `localStorage` (`usePersistedToggle`). Server-side visibility rules unchanged (`api/leaderboard` filters by kickoff).
- [x] Design system + animations (#12) — Tailwind-only motion system (route-change fade via `(app)/template.tsx`, button press feedback, optimistic pick submit with success `pop`, loading skeletons on picks/leaderboard/admin), consistent flat-dark cards (auth pages harmonized via `src/lib/ui.ts`), and a dark-theme lock in the root layout. GPU-friendly + `prefers-reduced-motion`-aware. Admin-panel skeletons landed in #63 (closed #62); remaining follow-up: #61 (harmonize forgot/reset-password pages).

## What Still Needs to Be Done

- [ ] **Tie handling** — score sync currently picks the home team as winner on ties. NFL regular season games can't tie (overtime rules), but worth verifying edge cases.
- [ ] **CI security scanning** — #26: add dependency vulnerability scanning (osv-scanner/npm audit) and consider CodeQL/secret scanning to `.github/workflows/ci.yml`, alongside the existing lint/test/build job.
- [ ] **Weather follow-ups** (split from #16): #101 refresh weather **and** spreads via cron (not just on picks-page load) — combines the former #67/#74. (#69 E2E coverage + seed fixture for the weather/dome strip: done.)
- [ ] **Betting-spread follow-ups** (split from #17): #72 E2E + seed coverage for the spread strip, #73 make the odds refresh gate multi-instance safe, #101 populate spreads via cron (combined with weather, was #74).

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
└── teams.test.ts           # Team name validation (trim, blank, collision, self-rename) — src/lib/teams.ts
```

These cover the core business logic extracted from API routes: kickoff locking, pick visibility (own picks always visible, admin sees all, others hidden until kickoff), grading (WIN/LOSS determination), playoff point escalation, and team-name validation. **When you add or change logic, extract it to a `lib/` helper and unit-test it in the same change — don't leave it inline in the route and don't defer coverage to a follow-up ticket.** API routes aren't unit-tested directly (they depend on Prisma/NextAuth); the E2E suite exercises them through the UI instead.

### End-to-end (Playwright)

The `e2e/` suite drives the **real UI** in a browser — use it (or extend a spec) when a change touches a page/flow.

```
e2e/
├── global-setup.ts     # drops/recreates a throwaway `gfl_e2e` DB, runs migrate deploy + seed-e2e
├── helpers.ts          # ADMIN/PLAYER1 creds, loginAs(page, ...)
├── auth.spec.ts        # login/register/logout
├── picks.spec.ts       # pick submit/change/lock + weather/dome strip (#69)
├── leaderboard.spec.ts # standings + team trophy
├── z-admin.spec.ts     # admin panel: invites, season create, team create + rename
├── password-reset.spec.ts
└── mobile.spec.ts      # runs only under the `mobile` project (iPhone 14 viewport)
```

- Run all: `pnpm test:e2e` (Playwright's `webServer` runs `PORT=3001 pnpm start`, so **a production build must exist** — run `pnpm build` first; `reuseExistingServer` is on outside CI).
- One spec/test: `pnpm exec playwright test z-admin.spec.ts --project=desktop -g "rename a team"`.
- Two projects (`playwright.config.ts`): `desktop` (Desktop Chrome, ignores `mobile.spec.ts`) and `mobile` (Chromium with iPhone 14 viewport, only `mobile.spec.ts`).
- Vitest ignores `e2e/**`; the E2E DB (`gfl_e2e`) is separate from the dev DB and rebuilt on every run, so tests can freely create/rename/delete.
- Selector gotcha: a team name renders both as a roster-card `<span>` **and** as an `<option>` in the "Assign Player" `<select>` — scope UI assertions to the card (e.g. filter by the card's Rename button) so `getByText` doesn't match two elements.
