---
name: mobile-lan-testing
description: How to test the GFL UI on a real phone over the LAN (pnpm dev:lan, allowedDevOrigins, NEXTAUTH_URL caveats). Use when testing mobile layouts on a physical device or debugging login/logout over a LAN IP.
---

# Testing on a real mobile device (same Wi-Fi)

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
