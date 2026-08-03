---
name: deployment-notes
description: Production Docker deployment constraints for GFL (Node 24, bookworm not Alpine, one-shot migrate service, nginx TLS/certbot). Use when changing the Dockerfile, docker-compose.prod.yml, deploy/ config, or deploying.
---

# Deployment

Production is Docker: `Dockerfile` (multi-stage) + `docker-compose.prod.yml` (Postgres + one-shot `migrate` service + app + nginx + `backup`/`certbot`/`reminders` sidecars). Full instructions in `DEPLOYMENT.md`. Non-obvious constraints learned building this:
- **Node 24** everywhere (`engines`/`.nvmrc`) — not the `node:20` you'll see in generic Next Docker guides.
- **Debian `bookworm-slim`, not Alpine** — the Prisma schema engine used by `migrate deploy` is the glibc/openssl3 build; Alpine (musl) would force a runtime engine download. `openssl` must be `apt-get install`ed (slim images omit it) or Prisma warns and misdetects libssl.
- **The app runner needs no Prisma engine** — the `@prisma/adapter-pg` driver adapter is pure JS, so the standalone runner stays slim (~390MB) and only the `migrator` stage carries the toolchain (~1.4GB).
- **Migrations run as a separate one-shot service**, not a per-replica entrypoint — the app waits on `depends_on: condition: service_completed_successfully`. This also sidesteps copying pnpm's symlinked store into the slim runner.
- **`NEXTAUTH_SECRET` fail-fast** lives in `src/instrumentation.ts` (`register()` runs once before serving); it throws in production if the secret is missing.
- **TLS terminates at nginx** (#40) — `deploy/nginx.conf.template` (an nginx *template*; the image `envsubst`s only `${DOMAIN}`, gated by `NGINX_ENVSUBST_FILTER=DOMAIN`, so `$host`/`$scheme` survive) redirects `:80`→HTTPS and terminates TLS 1.2/1.3 on `:443` with HSTS. Certs come from a `certbot` companion container (Let's Encrypt webroot challenge) in the shared `certbot_certs`/`certbot_www` volumes; it renews every 12h and nginx reloads every 6h — no manual step. First cert is bootstrapped once with `deploy/init-letsencrypt.sh` (dummy self-signed cert → start nginx → swap in the real cert), which resolves the nginx-needs-a-cert-to-start vs. webroot-needs-nginx chicken-and-egg. Set `NEXTAUTH_URL=https://…` so NextAuth issues Secure cookies. See `DEPLOYMENT.md` → TLS.
