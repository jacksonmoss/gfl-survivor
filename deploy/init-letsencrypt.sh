#!/bin/sh
# Bootstrap Let's Encrypt certificates for the production nginx proxy.
#
# Run this ONCE on a fresh host (or when switching to a new DOMAIN), BEFORE the
# normal `docker compose ... up`. It works around the chicken-and-egg problem
# that nginx won't start without a cert, but certbot's webroot challenge needs
# nginx running: it drops in a throwaway self-signed cert so nginx can boot,
# then swaps in a real Let's Encrypt cert. After this, the `certbot` service
# renews automatically — you never run this again for the same domain.
#
# Prereqs: DOMAIN must resolve to this host in public DNS, and ports 80/443 must
# be reachable from the internet. Set DOMAIN and CERTBOT_EMAIL in .env.prod.
#
# Usage:
#   ./deploy/init-letsencrypt.sh            # real certificate
#   STAGING=1 ./deploy/init-letsencrypt.sh  # Let's Encrypt staging (for testing;
#                                           # untrusted cert, but no rate limits)
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
  echo "error: .env.prod not found (copy .env.prod.example and fill it in)" >&2
  exit 1
fi

# Read DOMAIN / CERTBOT_EMAIL from .env.prod. Parse just these two keys rather
# than sourcing the whole file — other values (e.g. SMTP_FROM) contain spaces
# and shell metacharacters that `.`-sourcing would choke on. Compose reads the
# file with the same simple KEY=VALUE convention, so don't quote values there.
DOMAIN=$(grep -E '^DOMAIN=' .env.prod | tail -n1 | cut -d= -f2-)
CERTBOT_EMAIL=$(grep -E '^CERTBOT_EMAIL=' .env.prod | tail -n1 | cut -d= -f2-)

: "${DOMAIN:?set DOMAIN in .env.prod}"
: "${CERTBOT_EMAIL:?set CERTBOT_EMAIL in .env.prod}"

COMPOSE="docker compose -p gfl-prod -f docker-compose.prod.yml --env-file .env.prod"
cert_path="/etc/letsencrypt/live/$DOMAIN"

staging_arg=""
if [ "${STAGING:-0}" != "0" ]; then
  echo "### Using Let's Encrypt STAGING environment (cert will not be trusted)"
  staging_arg="--staging"
fi

echo "### Creating a temporary self-signed certificate for $DOMAIN ..."
$COMPOSE run --rm --entrypoint sh certbot -c "\
  mkdir -p '$cert_path' && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout '$cert_path/privkey.pem' \
    -out '$cert_path/fullchain.pem' \
    -subj '/CN=localhost'"

echo "### Starting nginx ..."
$COMPOSE up -d nginx

echo "### Removing the temporary certificate ..."
$COMPOSE run --rm --entrypoint sh certbot -c "\
  rm -rf '/etc/letsencrypt/live/$DOMAIN' \
         '/etc/letsencrypt/archive/$DOMAIN' \
         '/etc/letsencrypt/renewal/$DOMAIN.conf'"

echo "### Requesting a Let's Encrypt certificate for $DOMAIN ..."
$COMPOSE run --rm certbot certonly --webroot -w /var/www/certbot \
  $staging_arg \
  --email "$CERTBOT_EMAIL" \
  -d "$DOMAIN" \
  --rsa-key-size 2048 \
  --agree-tos \
  --no-eff-email \
  --force-renewal

echo "### Reloading nginx with the new certificate ..."
$COMPOSE exec nginx nginx -s reload

echo "### Done. Bring the full stack up with:"
echo "    $COMPOSE up -d --build"
