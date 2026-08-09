#!/usr/bin/env bash
# Drive the local beta stack (docker-compose.beta.yml).
#
# Runs the real production app image locally and, by default, fronts it with a
# Cloudflare quick tunnel so a remote customer can reach it over HTTPS with no
# domain, no port forwarding, and no Cloudflare account.
#
# Why this wrapper exists: a quick tunnel's hostname is random and only known
# once cloudflared has started, but NEXTAUTH_URL must already match the public
# origin when the app boots — otherwise login appears to succeed and then
# bounces straight back to /login, because the session cookie is rejected. So
# startup is two-phase: tunnel first, read the URL out of its log, then boot the
# app with that URL. The resolved values land in .env.beta.runtime.
#
# Usage:
#   ./scripts/beta.sh up [--lan] [--seed demo|clean|none]
#   ./scripts/beta.sh url
#   ./scripts/beta.sh seed demo|clean
#   ./scripts/beta.sh logs [service]
#   ./scripts/beta.sh ps
#   ./scripts/beta.sh psql [args...]
#   ./scripts/beta.sh down [--wipe]
#
# See docs/BETA-TESTING.md.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.beta.yml"
ENV_FILE=".env.beta"
RUNTIME_ENV=".env.beta.runtime"
TUNNEL_HOST_RE='https://[a-z0-9-]+\.trycloudflare\.com'

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
say() { printf '\033[36m==>\033[0m %s\n' "$*"; }

# ── Env plumbing ──────────────────────────────────────────────────────────────

# Compose accepts repeated --env-file and the LAST one wins, so the generated
# runtime file cleanly overrides the user-edited one. Both must exist.
ensure_env_files() {
  if [ ! -f "$ENV_FILE" ]; then
    say "no $ENV_FILE — creating one from .env.beta.example"
    cp .env.beta.example "$ENV_FILE"
  fi
  [ -f "$RUNTIME_ENV" ] || : > "$RUNTIME_ENV"

  # Compose interpolates the WHOLE compose file on every command, even one that
  # only names `cloudflared`. So the app service's required NEXTAUTH_URL and
  # NEXTAUTH_SECRET must already hold values before we can start the tunnel that
  # tells us what the real NEXTAUTH_URL is. Seed a placeholder here; start_tunnel
  # overwrites it with the live hostname before the app is ever started. Keeping
  # the `:?` guards in the compose file means a hand-rolled `docker compose` run
  # without this wrapper still fails loudly rather than booting unusably.
  ensure_secret
  if [ -z "$(env_get NEXTAUTH_URL "$ENV_FILE")" ] && [ -z "$(env_get NEXTAUTH_URL "$RUNTIME_ENV")" ]; then
    runtime_set NEXTAUTH_URL "$(placeholder_url)"
  fi
}

# Stand-in origin used only to satisfy interpolation before the real URL is
# known, and parked here again after `down` so later compose calls still work.
placeholder_url() { printf 'http://localhost:%s' "$(app_port)"; }

# Read a key from an env file without sourcing it (values may contain spaces,
# and sourcing an env file executes it).
env_get() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -1
}

# Set (or replace) a key in the generated runtime env file.
runtime_set() {
  local key="$1" value="$2"
  [ -f "$RUNTIME_ENV" ] || : > "$RUNTIME_ENV"
  # Rewrite via a temp file so a failed sed can't truncate the original.
  grep -v "^${key}=" "$RUNTIME_ENV" > "$RUNTIME_ENV.tmp" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$value" >> "$RUNTIME_ENV.tmp"
  mv "$RUNTIME_ENV.tmp" "$RUNTIME_ENV"
}

# NEXTAUTH_SECRET is required (src/instrumentation.ts fails fast without it in
# production, which the runner image is). Nobody should hand-edit a secret to
# run a demo, so generate one and keep it stable across restarts — regenerating
# it would invalidate every tester's session mid-session.
ensure_secret() {
  if [ -n "$(env_get NEXTAUTH_SECRET "$ENV_FILE")" ]; then return; fi
  if [ -n "$(env_get NEXTAUTH_SECRET "$RUNTIME_ENV")" ]; then return; fi
  local secret
  secret="$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)"
  runtime_set NEXTAUTH_SECRET "$secret"
  say "generated a NEXTAUTH_SECRET for this install ($RUNTIME_ENV)"
}

app_port() {
  local p
  p="$(env_get APP_PORT "$ENV_FILE")"
  printf '%s' "${p:-3000}"
}

compose() {
  docker compose -f "$COMPOSE_FILE" \
    --env-file "$ENV_FILE" --env-file "$RUNTIME_ENV" \
    --profile tunnel "$@"
}

# ── Tunnel ────────────────────────────────────────────────────────────────────

start_tunnel() {
  say "starting the Cloudflare quick tunnel"
  # No --build: cloudflared is a pulled image, and building the app here would
  # delay the tunnel we're about to read the URL from.
  compose up -d cloudflared

  say "waiting for Cloudflare to assign a hostname"
  local url="" waited=0
  while [ "$waited" -lt 90 ]; do
    url="$(compose logs --no-color cloudflared 2>&1 | grep -oE "$TUNNEL_HOST_RE" | head -1 || true)"
    [ -n "$url" ] && break
    sleep 2
    waited=$((waited + 2))
  done

  [ -n "$url" ] || die "the tunnel never reported a URL after ${waited}s.
Check 'docker compose -f $COMPOSE_FILE --profile tunnel logs cloudflared'.
If this host blocks outbound connections to Cloudflare, run LAN-only instead:
  ./scripts/beta.sh up --lan"

  runtime_set NEXTAUTH_URL "$url"
  say "public URL: $url"
}

lan_url() {
  # The address a phone on the same WiFi would use. Overridable for hosts with
  # several interfaces, where the route lookup can pick the wrong one.
  local ip="${BETA_LAN_IP:-}"
  if [ -z "$ip" ]; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  fi
  [ -n "$ip" ] || die "couldn't detect a LAN IP. Set it explicitly: BETA_LAN_IP=192.168.1.x ./scripts/beta.sh up --lan"
  printf 'http://%s:%s' "$ip" "$(app_port)"
}

# ── Database ──────────────────────────────────────────────────────────────────

# psql inside the db container. Credentials come from the env file, not the host
# shell — the compose file's defaults and .env.beta must not drift apart.
psql() {
  local user db
  user="$(env_get POSTGRES_USER "$ENV_FILE")"
  db="$(env_get POSTGRES_DB "$ENV_FILE")"
  compose exec -T db psql -U "${user:-gfl}" -d "${db:-gfl}" "$@"
}

# Row count of the User table, or empty if the schema isn't there yet (fresh
# volume, migrations not yet applied) — both mean "nothing has been seeded".
user_count() {
  psql -tAc 'select count(*) from "User"' 2>/dev/null | tr -d '[:space:]' || true
}

seed() {
  local mode="${1:-demo}"
  case "$mode" in
    demo|clean) ;;
    *) die "unknown seed mode '$mode' (expected 'demo' or 'clean')" ;;
  esac

  ensure_env_files

  # Stop the app first: the reset drops every table, and an app holding open
  # connections to vanished tables throws on every request until it reconnects.
  say "stopping the app while the database is rebuilt"
  compose stop app >/dev/null 2>&1 || true

  say "resetting the database"
  # No --skip-generate: Prisma v7's `migrate reset` dropped that flag and errors
  # out on it. It regenerates the client into the image's writable layer, which
  # is throwaway here anyway.
  compose run --rm migrate pnpm prisma migrate reset --force

  if [ "$mode" = "demo" ]; then
    say "seeding the demo league (10 players, 3 teams, 3 graded weeks, week 4 open)"
    compose run --rm migrate pnpm seed:demo
  else
    say "seeding a clean install (admin + invite codes only)"
    compose run --rm migrate pnpm seed
  fi

  say "restarting the app"
  compose up -d app
  cat <<'EOF'

Note: sessions are JWTs signed with a secret that survives a reseed, so anyone
who was logged in still holds a token for a user that no longer exists. Tell
testers to log out (or use a fresh private window) after a reseed.
EOF
}

# ── Commands ──────────────────────────────────────────────────────────────────

cmd_up() {
  local mode="tunnel" seed_mode="auto"
  while [ $# -gt 0 ]; do
    case "$1" in
      --lan) mode="lan"; shift ;;
      --tunnel) mode="tunnel"; shift ;;
      --seed) seed_mode="${2:-}"; shift 2 ;;
      *) die "unknown option '$1'" ;;
    esac
  done

  command -v docker >/dev/null || die "docker is not installed"
  docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not available"

  ensure_env_files

  if [ "$mode" = "tunnel" ]; then
    start_tunnel
  else
    local url
    url="$(lan_url)"
    runtime_set NEXTAUTH_URL "$url"
    say "LAN URL: $url"
    # Leave no stale tunnel running with a URL that no longer matches
    # NEXTAUTH_URL — it would serve login bounces to anyone still on it.
    compose rm -sf cloudflared >/dev/null 2>&1 || true
  fi

  say "building and starting the app (first build takes a few minutes)"
  compose up -d --build app

  say "waiting for the app to report healthy"
  local waited=0
  until curl -fsS "http://127.0.0.1:$(app_port)/api/health" >/dev/null 2>&1; do
    [ "$waited" -ge 180 ] && die "the app never became healthy. Check: ./scripts/beta.sh logs app"
    sleep 3
    waited=$((waited + 3))
  done
  say "healthy"

  # Auto-seed only a genuinely empty database, so re-running `up` never
  # destroys data a customer has entered mid-beta.
  if [ "$seed_mode" = "auto" ]; then
    local count
    count="$(user_count)"
    if [ -z "$count" ] || [ "$count" = "0" ]; then
      say "database is empty — seeding the demo league"
      seed demo
    else
      say "database already has $count users — leaving it alone"
      say "to start over: ./scripts/beta.sh seed demo"
    fi
  elif [ "$seed_mode" != "none" ]; then
    seed "$seed_mode"
  fi

  local url
  url="$(env_get NEXTAUTH_URL "$RUNTIME_ENV")"
  cat <<EOF

────────────────────────────────────────────────────────────────────
  Beta instance is up:  $url

  Admin:    admin / admin123
  Players:  jdog, mike_t, sara_k, bigben, chadwick,
            tommy_b, lucky13, ace_v, queenb, zeke99   (password: password)

  Change the admin password before sharing this URL widely — admin123
  is a published default and this URL is reachable by anyone who has it.

  Walkthrough script for the customer: docs/BETA-TESTING.md
  Logs:  ./scripts/beta.sh logs
  Stop:  ./scripts/beta.sh down
────────────────────────────────────────────────────────────────────
EOF
  if [ "$mode" = "tunnel" ]; then
    cat <<'EOF'
  Quick-tunnel URLs are ephemeral: this hostname dies when the stack
  stops and a restart gets a new one. Re-send the URL after any restart.

EOF
  fi
}

cmd_url() {
  ensure_env_files
  local url
  url="$(env_get NEXTAUTH_URL "$RUNTIME_ENV")"
  if [ -z "$url" ] || [ "$url" = "$(placeholder_url)" ]; then
    die "no live URL — the stack is down or was never started. Run ./scripts/beta.sh up"
  fi
  printf '%s\n' "$url"
}

cmd_down() {
  ensure_env_files
  if [ "${1:-}" = "--wipe" ]; then
    say "stopping the stack and deleting the beta database"
    compose down -v
  else
    say "stopping the stack (database preserved)"
    compose down
  fi
  # The recorded URL is dead once the tunnel is gone, so `url` must stop handing
  # it out — but it has to stay non-empty or the next compose call fails
  # interpolation. Park it back on the placeholder.
  runtime_set NEXTAUTH_URL "$(placeholder_url)"
}

case "${1:-}" in
  up)   shift; cmd_up "$@" ;;
  url)  shift; cmd_url ;;
  seed) shift; seed "${1:-demo}" ;;
  logs) shift; ensure_env_files; compose logs -f "${1:-app}" ;;
  ps)   shift; ensure_env_files; compose ps ;;
  psql) shift; ensure_env_files; psql "$@" ;;
  down) shift; cmd_down "${1:-}" ;;
  ""|-h|--help)
    sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *) die "unknown command '${1}'. Try: ./scripts/beta.sh --help" ;;
esac
