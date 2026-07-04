# Deployment

Production runs the app as a self-contained Next.js standalone server in Docker,
behind an nginx reverse proxy, with Postgres in a sibling container. Database
migrations are applied by a one-shot `migrate` service before the app starts.

## Prerequisites

- Docker Engine with the Compose plugin (`docker compose`)
- A host reachable on port 80 (add TLS in front — see below)

## Configure

```bash
cp .env.prod.example .env.prod
# edit .env.prod: set POSTGRES_PASSWORD, DATABASE_URL, NEXTAUTH_URL,
# and NEXTAUTH_SECRET (openssl rand -base64 32)
```

`NEXTAUTH_SECRET` is **required**. The app fails fast on startup
(`src/instrumentation.ts`) with a clear error if it is missing in production.

## Run

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Startup order is enforced by Compose:

1. `db` becomes healthy (`pg_isready`).
2. `migrate` runs `prisma migrate deploy` and exits successfully.
3. `app` starts only after the migrator completed (`service_completed_successfully`).
4. `nginx` proxies port 80 → `app:3000`.

Seed an initial admin + invite codes once the stack is up:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm migrate pnpm seed
```

(The `migrate` image carries the full toolchain, so it can also run seed scripts.)

## Images (single multi-stage Dockerfile)

| Target     | Base                   | Purpose                                                  |
| ---------- | ---------------------- | -------------------------------------------------------- |
| `deps`     | `node:24-bookworm-slim`| Install dependencies (frozen lockfile)                   |
| `builder`  | `node:24-bookworm-slim`| `prisma generate` + `next build` (standalone output)     |
| `migrator` | `node:24-bookworm-slim`| One-shot `prisma migrate deploy` / seed scripts          |
| `runner`   | `node:24-bookworm-slim`| Slim runtime — only the standalone server + static assets|

Notes:

- **Node 24**, per `engines` in `package.json` / `.nvmrc`.
- **Debian (bookworm), not Alpine**, so the Prisma schema engine (glibc/openssl 3)
  used by `migrate deploy` runs without downloading a musl build.
- The **runner needs no Prisma engine** — the app talks to Postgres via the
  `@prisma/adapter-pg` driver adapter (pure JS).
- The runner runs as the unprivileged `node` user.

## TLS

`deploy/nginx.conf` terminates plain HTTP on port 80. For production, terminate
HTTPS in front of the app and set `NEXTAUTH_URL` to the `https://` origin. Options:

- Add a `443` server block with certificates (e.g. Let's Encrypt via certbot) to
  `deploy/nginx.conf` and publish port 443.
- Or front the stack with a managed load balancer / Cloudflare and keep nginx on 80.

nginx already forwards `X-Forwarded-Proto` / `X-Forwarded-Host` so NextAuth builds
correct absolute callback URLs behind the proxy.

## Managed platforms (Railway / Render)

The same Dockerfile works on any container platform. Point the build at the
`runner` target, run `prisma migrate deploy` as a release/pre-deploy command, and
set `DATABASE_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET` as service env vars.
