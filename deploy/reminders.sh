#!/bin/sh
# Poll the pick-reminders endpoint on a schedule.
#
# Runs as a long-lived companion container (see the `reminders` service in
# docker-compose.prod.yml). Every $REMINDER_INTERVAL it POSTs to the app's
# reminders endpoint with the CRON_SECRET bearer token. The endpoint is
# idempotent per (user, week, slot) and self-gates to slot windows, so frequent
# polling is safe — it only emails when a reminder slot is actually due.
#
# The call goes over the internal compose network to the `app` service, not
# through nginx/HTTPS, so the CRON_SECRET never leaves the private network.
#
# Env:
#   APP_URL           — base URL of the app service (default http://app:3000)
#   CRON_SECRET       — bearer token (required; must match the app's)
#   REMINDER_INTERVAL — seconds between polls (default 900 = 15 min)
set -eu

: "${APP_URL:=http://app:3000}"
: "${REMINDER_INTERVAL:=900}"

# Without a secret the endpoint returns 503 and nothing can be sent, so idle
# rather than crash-looping — the stack stays up and reminders start working as
# soon as CRON_SECRET is configured and the sidecar restarts.
if [ -z "${CRON_SECRET:-}" ]; then
  echo "[reminders] CRON_SECRET is not set; reminders are disabled. Idling." >&2
  while :; do sleep 3600 & wait $!; done
fi

ENDPOINT="$APP_URL/api/admin/reminders/send"

send_once() {
  # The runner image is Node-only (no curl), so POST with node's global fetch.
  # A non-2xx response or a network error exits non-zero and is logged.
  ENDPOINT="$ENDPOINT" node -e '
    // Bound each request so a hung call can never stall the poll loop.
    fetch(process.env.ENDPOINT, {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
      signal: AbortSignal.timeout(30000),
    })
      .then(async (r) => {
        const body = (await r.text()).trim();
        if (!r.ok) {
          console.error("[reminders] send failed: HTTP " + r.status + " " + body);
          process.exit(1);
        }
        console.log("[reminders] " + body);
      })
      .catch((e) => {
        console.error("[reminders] send failed: " + e.message);
        process.exit(1);
      });
  '
}

echo "[reminders] starting: every ${REMINDER_INTERVAL}s -> $ENDPOINT"
while :; do
  send_once || true
  sleep "$REMINDER_INTERVAL" &
  wait $!
done
