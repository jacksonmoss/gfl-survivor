# GFL Survivor Pool

Custom NFL survivor pool app built for Jackson's league. Replaces Splash Sports with support for playoff point escalation and team trophies.

## Quick start

```bash
# 1. Start the database
docker compose up -d

# 2. Copy env and fill in required values
cp .env.example .env

# 3. Run migrations and seed demo data
npx prisma migrate deploy
npm run seed:demo     # or: npm run seed  (minimal — admin + invite codes only)

# 4. Start the dev server
npm run dev           # → http://localhost:3000
```

Demo credentials (seed:demo only):
- Admin: `admin` / `admin123`
- Players: any of `jdog`, `mike_t`, `sara_k`, `bigben`, `chadwick`, `tommy_b`, `lucky13`, `ace_v`, `queenb`, `zeke99` with password `password`

## Environment variables

See `.env.example` for all variables. Required in production:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_URL` | Full public URL (e.g. `https://gfl.example.com`) |
| `NEXTAUTH_SECRET` | Random secret — generate with `openssl rand -base64 32` |

SMTP variables are optional. When `SMTP_HOST` is unset, password reset links are logged to the server console instead of being emailed.

## Common tasks

```bash
npm run dev           # Dev server with Turbopack
npm run build         # Production build
npm test              # Vitest unit tests
npm run lint          # ESLint

npx prisma studio     # Browse the DB in a GUI
npx prisma migrate dev --name <name>   # Create a new migration
npx prisma migrate deploy              # Apply pending migrations (production)
```

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Database | PostgreSQL 16 (Docker Compose for dev) |
| ORM | Prisma v7 |
| Auth | NextAuth v4 (credentials) |
| Styling | Tailwind CSS v4 |
| Testing | Vitest |
| Email | nodemailer (SMTP or console fallback) |

## Project structure

```
src/
├── app/
│   ├── (app)/            # Authenticated layout (picks, leaderboard, settings, admin)
│   ├── api/              # Route handlers
│   ├── login/            # Login page
│   ├── register/         # Invite-gated registration
│   ├── forgot-password/  # Request a reset link
│   └── reset-password/   # Consume reset token
├── lib/
│   ├── auth.ts           # NextAuth config
│   ├── prisma.ts         # Prisma client singleton
│   ├── mailer.ts         # nodemailer transport
│   ├── password-reset.ts # Token helpers
│   └── espn.ts           # ESPN API helpers
└── __tests__/            # Unit tests
```
