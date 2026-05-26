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
npm run seed                  # Minimal: admin user + 5 invite codes
npm run seed:demo             # Full demo: 10 players, 3 teams, 3 weeks of data, week 4 upcoming
npm run dev                   # http://localhost:3000
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

## Prisma v7 Gotchas

Prisma v7 has breaking changes from v5/v6:
- **No `url` in schema.prisma datasource block** — connection URL goes in `prisma.config.ts` only
- **PrismaClient requires an adapter**: `new PrismaClient({ adapter: new PrismaPg(connectionString) })`
- **Generated client output** is at `src/generated/prisma/client.ts` — import from `@/generated/prisma/client`
- **Seed scripts** need `import "dotenv/config"` at top since env vars aren't auto-loaded

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
│   │   ├── picks/page.tsx          # Main pick page — week selector, team grid, pick history
│   │   ├── leaderboard/page.tsx    # Player standings + team trophy tab
│   │   ├── settings/page.tsx       # Profile, password change, team management
│   │   └── admin/page.tsx          # Season creation, invite code generation (ADMIN only)
│   └── api/
│       ├── auth/[...nextauth]/     # NextAuth handler
│       ├── auth/register/          # POST — invite-gated registration
│       ├── picks/                  # GET season+picks, POST submit/change pick
│       ├── leaderboard/            # GET player standings + team trophy
│       ├── settings/               # GET profile, PATCH update name/password
│       ├── teams/                  # GET list, POST create/join/leave
│       └── admin/
│           ├── invites/            # GET/POST invite codes (admin only)
│           └── season/             # GET/POST seasons (admin only)
├── components/
│   └── navbar.tsx                  # Responsive nav with mobile hamburger menu
└── lib/
    ├── auth.ts                     # NextAuth config (credentials provider, JWT callbacks)
    ├── types.ts                    # NextAuth session/JWT type augmentation
    ├── prisma.ts                   # Singleton PrismaClient with PrismaPg adapter
    └── nfl-teams.ts                # All 32 NFL teams with abbreviations, names, conference, division
```

## Data Model

```
User ──┬── Pick (one per user per week, unique on userId+weekId)
       ├── Team (optional, for team trophy)
       ├── InviteCode (used one to register)
       └── InviteCode[] (created, if admin)

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
- **Week selector** — horizontal scrollable pills, color-coded by pick result (green=win, red=loss, blue=selected)
- **Admin role** — only admins see the Admin nav link; API routes check `session.user.role === "ADMIN"`
- **Invite-only** — registration requires an invite code; admins generate them from the admin panel
- **Season creation** auto-generates all 22 weeks (18 regular + 4 playoff) with correct point values

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

## What Still Needs to Be Done

- [ ] **Live game data integration** — pull real NFL scores from an API (ESPN unofficial API or similar). Need a service that fetches game schedules at season start and polls scores during game days.
- [ ] **Auto-grade picks** — background job/cron that checks completed games and sets pick results (WIN/LOSS) and awards points based on the week's `pointValue`. Currently picks are only graded in the demo seed.
- [ ] **Real NFL schedule import** — admin tool or script to import actual NFL schedules for a season (game times, teams, matchups) rather than manually creating them.
- [ ] **Password reset** — currently no way to recover a forgotten password. Could add email or admin-reset flow.
- [ ] **Notifications** — remind users to make their pick before kickoff (email, push, or in-app).
- [ ] **Pick visibility** — decide if/when other users' picks should be visible (e.g., hidden until all games kick off, or always visible on leaderboard).
- [ ] **Season history** — view past seasons' results, not just the active one.
- [ ] **Deployment** — self-hosted initially; Docker Compose for production with nginx reverse proxy, or move to a managed platform.
- [ ] **NEXTAUTH_SECRET** — generate a real secret for production (`openssl rand -base64 32`).
- [ ] **Tests** — no test suite yet.
