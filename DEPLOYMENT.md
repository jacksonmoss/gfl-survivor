# Deployment

Production runs the app as a self-contained Next.js standalone server in Docker,
behind an nginx reverse proxy, with Postgres in a sibling container. Database
migrations are applied by a one-shot `migrate` service before the app starts.

## Prerequisites

- Docker Engine with the Compose plugin (`docker compose`)
- A public domain pointed at this host (DNS `A`/`AAAA` record) with ports 80 and
  443 reachable from the internet — nginx terminates HTTPS (see [TLS](#tls))

## Configure

```bash
cp .env.prod.example .env.prod
# edit .env.prod: set POSTGRES_PASSWORD, DATABASE_URL, DOMAIN, CERTBOT_EMAIL,
# NEXTAUTH_URL (the https:// DOMAIN), and NEXTAUTH_SECRET (openssl rand -base64 32)
```

`NEXTAUTH_SECRET` is **required**. The app fails fast on startup
(`src/instrumentation.ts`) with a clear error if it is missing in production.

Optional: `ODDS_API_KEY` ([The Odds API](https://the-odds-api.com/), free tier
500 req/month) enables the betting-spread strip on matchup cards. When unset,
cards simply omit the spread — no error. See `.env.example`.

## Run

**First time only — bootstrap the TLS certificate** (see [TLS](#tls) for how it
works). With DNS already pointing at this host:

```bash
./deploy/init-letsencrypt.sh
```

Then bring the full stack up:

```bash
docker compose -p gfl-prod -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

> **Use a distinct project name (`-p gfl-prod`).** The dev stack
> (`docker-compose.yml`) and this prod stack both default their Compose project
> name to the directory (`gfl`), which means they'd **share the `gfl_pgdata`
> volume**. If you run the prod stack without `-p` on a machine that has ever run
> the dev stack, Postgres reuses the dev volume (initialized with the dev
> password) and migrations fail with `P1000: Authentication failed`. Pick a name
> and keep using it for every `docker compose` command against this stack, or set
> `COMPOSE_PROJECT_NAME=gfl-prod` in `.env.prod`. All commands below assume
> `-p gfl-prod`.

Startup order is enforced by Compose:

1. `db` becomes healthy (`pg_isready`).
2. `migrate` runs `prisma migrate deploy` and exits successfully.
3. `app` starts only after the migrator completed (`service_completed_successfully`).
4. `nginx` terminates HTTPS on 443 → `app:3000` and redirects port 80 → HTTPS.
5. `certbot` renews the certificate in the background.

Seed an initial admin + invite codes once the stack is up:

```bash
docker compose -p gfl-prod -f docker-compose.prod.yml --env-file .env.prod run --rm migrate pnpm seed
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

nginx terminates HTTPS on port 443 with a Let's Encrypt certificate, and
redirects all plain HTTP (`:80`) to HTTPS. Certificates are obtained and renewed
by a `certbot` companion container using the ACME **webroot** challenge — no
manual annual step.

**How it fits together:**

- `deploy/nginx.conf.template` has two server blocks: `:80` serves
  `/.well-known/acme-challenge/` (from the shared `certbot_www` volume) and 301s
  everything else to HTTPS; `:443` terminates TLS (TLS 1.2/1.3, ECDHE ciphers),
  sends `Strict-Transport-Security`, and proxies to `app:3000`. It's an nginx
  *template* — the image runs `envsubst` at startup to fill in `${DOMAIN}`
  (`NGINX_ENVSUBST_FILTER=DOMAIN` keeps nginx's own `$host`/`$scheme` vars intact).
- The `certbot` service runs `certbot renew` every 12h; certbot only acts when
  the cert is within 30 days of expiry. nginx reloads every 6h to pick up a
  renewed cert. Certs live in the `certbot_certs` volume, shared read-only with
  nginx.

**First-time bootstrap** (`deploy/init-letsencrypt.sh`): nginx can't start
without a cert, but the webroot challenge needs nginx running — so the script
drops in a throwaway self-signed cert, starts nginx, then swaps in the real
Let's Encrypt cert and reloads. Run it once per host/domain:

```bash
# set DOMAIN + CERTBOT_EMAIL in .env.prod first, and point DNS at this host
./deploy/init-letsencrypt.sh
# test against Let's Encrypt staging (untrusted cert, no rate limits):
STAGING=1 ./deploy/init-letsencrypt.sh
```

Set `NEXTAUTH_URL=https://your-domain.com` — the `https://` origin makes NextAuth
issue **Secure** cookies. nginx forwards `X-Forwarded-Proto` / `X-Forwarded-Host`
so NextAuth builds correct absolute callback URLs behind the proxy.

**Alternative — front with a managed LB / Cloudflare:** point it at this host and
let it terminate TLS. Cloudflare "Full (strict)" works as-is against the real
origin cert this stack already provisions. If your fronting layer terminates TLS
itself and talks HTTP to the origin, ensure it forwards `X-Forwarded-Proto=https`
and still set `NEXTAUTH_URL` to the `https://` origin.

## Managed platforms (Railway / Render)

The same Dockerfile works on any container platform. Point the build at the
`runner` target, run `prisma migrate deploy` as a release/pre-deploy command, and
set `DATABASE_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET` as service env vars.

## Operational notes

All commands assume `-p gfl-prod` (see the note under [Run](#run)).

**Update / redeploy** — rebuild and recreate; the `migrate` service reruns and
applies any new migrations before the app restarts:

```bash
git pull
docker compose -p gfl-prod -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

**Logs / status:**

```bash
docker compose -p gfl-prod -f docker-compose.prod.yml ps
docker compose -p gfl-prod -f docker-compose.prod.yml logs -f app
```

**Back up / restore the database** — the `backup` service runs `pg_dump`
automatically. It reuses the `postgres:16-alpine` image (no extra dependency),
writes a compressed, date-stamped custom-format dump (`gfl-YYYYmmdd-HHMMSS.dump`)
into the `./backups` host directory on a schedule, and prunes to the newest
`BACKUP_KEEP` dumps. `./backups` is a bind mount outside the `pgdata` volume, so
dumps survive loss of that volume. Interval and retention are tunable in
`.env.prod` (`BACKUP_INTERVAL`, default daily; `BACKUP_KEEP`, default 7); see
`deploy/backup.sh`.

For off-host durability (surviving loss of the whole host), sync `./backups` to
object storage — e.g. a cron'd `rclone/aws s3 sync ./backups <remote>`.

Check the latest dump and trigger one on demand:

```bash
ls -lt backups/                                                   # newest first
docker compose -p gfl-prod -f docker-compose.prod.yml restart backup   # run now
```

**Restore** from a dump with `pg_restore` (`--clean --if-exists` drops existing
objects first, so it works into the live DB; restore into a scratch DB first if
you want to verify without touching production):

```bash
# into the live database (app should be stopped: `... stop app`)
docker compose -p gfl-prod -f docker-compose.prod.yml --env-file .env.prod \
  exec -T db pg_restore -U gfl -d gfl --clean --if-exists < backups/gfl-YYYYmmdd-HHMMSS.dump
```

**Health / readiness** — the app exposes an unauthenticated `GET /api/health`
that returns `200 {"ok":true}` when the server is up and the DB is reachable
(`503` otherwise). The `app` service has a Docker `healthcheck` hitting it, and
**nginx waits on `condition: service_healthy`** before starting — so a clean
`up -d` / redeploy no longer serves 502s while Next.js is still booting. Check
it directly with:

```bash
curl -fsS https://your-host/api/health   # {"ok":true}
docker compose -p gfl-prod -f docker-compose.prod.yml ps   # app shows "healthy"
```

**Stop / tear down:**

```bash
docker compose -p gfl-prod -f docker-compose.prod.yml down          # keep data
docker compose -p gfl-prod -f docker-compose.prod.yml down -v       # also delete the DB volume
```

## Pick reminders (cron)

Pick-deadline reminders are sent by an external scheduler hitting an
authenticated endpoint — there is no in-app scheduler. Set `CRON_SECRET` in
`.env.prod` (`openssl rand -hex 32`) and configure SMTP (see [Configure](#configure));
without SMTP the reminders are logged to the app console instead of emailed.

The endpoint is idempotent per (user, week, reminder slot), so it's safe to call
often — poll it every ~15 minutes and it emails only when a slot's window is open
(regular season: ~3h before Thursday night and the first Sunday game; playoffs:
the morning of the week's first game) and only users who still haven't picked and
haven't opted out:

```bash
curl -fsS -X POST https://your-host/api/admin/reminders/send \
  -H "Authorization: Bearer $CRON_SECRET"
```

Wire it to whatever scheduler the host provides — a crontab line, a Railway/Render
cron job, or a GitHub Actions scheduled workflow. Example crontab (every 15 min):

```cron
*/15 * * * * curl -fsS -X POST https://your-host/api/admin/reminders/send -H "Authorization: Bearer $CRON_SECRET" >/dev/null
```

Lead time is tunable with `REMINDER_LEAD_HOURS` (default 3).

### Known gaps (tracked separately)

- **nginx reloads on a 6h timer, not on renewal** — a renewed cert can be up to
  ~6h stale in nginx; switch to a certbot `--deploy-hook`. (#80)
- **TLS cert covers only the single `DOMAIN`** — no apex+`www` SAN or canonical
  redirect. (#81)
