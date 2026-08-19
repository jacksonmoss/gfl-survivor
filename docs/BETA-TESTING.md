# GFL Survivor — Local Beta Testing

How to stand the real app up on your own machine and give a customer a working
URL, so they can click through it, test usability, and sign off on requirements
before you commit to a server and a domain.

This runs the **same production image** the real deployment uses
(`Dockerfile` → `runner`), so what the customer sees is what ships. It is not
`pnpm dev`.

| | Beta (this doc) | Production (`DEPLOYMENT.md`) |
| --- | --- | --- |
| Where | Your laptop/desktop | Customer's server |
| URL | Random `*.trycloudflare.com`, changes on restart | Their permanent domain |
| TLS | Cloudflare's | Let's Encrypt, auto-renewed |
| Lifetime | Hours — dies when you stop it | The season |
| Data | Throwaway, reseedable | Real, backed up daily |

**Do not run a season on this.** Quick tunnels are ephemeral and unmonitored.
When the customer signs off, deploy properly with
[`docs/SEASON-LAUNCH.md`](SEASON-LAUNCH.md).

---

## Quick start

You need Docker with the Compose plugin. Nothing else — no domain, no port
forwarding, no Cloudflare account, no config file to edit.

```bash
./scripts/beta.sh up
```

First run takes a few minutes (it builds the app image). It prints:

```
==> public URL: https://some-random-words.trycloudflare.com
```

Send that URL to the customer. They open it on a phone or laptop, anywhere.

```bash
./scripts/beta.sh logs     # follow the app log
./scripts/beta.sh url      # reprint the current URL
./scripts/beta.sh down     # stop (keeps the database)
```

### Before you share the URL

The tunnel is public — anyone with the link reaches the app. Registration is
invite-gated, but **`admin` / `admin123` is a published default in this repo**.
Log in and change it (Settings → Password) before sending the link anywhere you
don't fully control.

---

## The two data modes

```bash
./scripts/beta.sh seed demo     # populated league
./scripts/beta.sh seed demo-mode # 2026 weeks 1-4 scheduled, nobody has picked — for the demo simulator
./scripts/beta.sh seed clean    # empty league, admin + invite codes only
```

All three wipe the database first. `up` seeds `demo` automatically the first
time, and never re-seeds on later runs — so re-running `up` mid-beta can't
destroy what the customer has entered.

### `demo` — for usability

10 players, 3 teams, a 2025 season with weeks 1–3 graded and **week 4 open with
kickoffs three days out**. Leaderboard, stats, trophies, and the pick page are
all populated on first load, so the customer can judge the interface
immediately instead of staring at empty tables.

Logins: `admin` / `admin123`; players `jdog`, `mike_t`, `sara_k`, `bigben`,
`chadwick`, `tommy_b`, `lucky13`, `ace_v`, `queenb`, `zeke99` — all with the
password `password`.

The seed writes picks for **weeks 1–3 only** — week 4 starts with nobody having
picked, which is what makes it usable as a live demo. So there is nothing to see
on week 4 until you make a pick yourself.

The demo weeks carry betting lines, including deliberate upsets, so the stats
page's upset and consensus-bust detection has something real to show without an
odds API key.

> **Demo games are not linked to ESPN.** They're fabricated rows with no
> `externalId`, and the score sync only touches games that have one
> (`src/lib/score-sync.ts`). So **"Sync Live Scores" does nothing in demo mode** —
> that is expected, not a bug. To demonstrate real scoring, use `clean` mode
> below.

### `demo-mode` — for demoing the pick → grade loop

The 2026 season with **weeks 1–4 scheduled** — four full 16-game slates, the
first opening on the next Thursday — and **no picks at all**. The customer
makes the first pick in the league, then presses **Simulate week** (or
**Simulate 4 weeks**) and watches it play out. Same players, teams and logins
as `demo`.

This is the mode to use with `DEMO_MODE` on.

### `clean` — for requirements realism

An admin account and five invite codes, nothing else. You then walk the customer
through the actual setup they'd do on day one — create the season, import the
real NFL schedule from ESPN, create teams, invite players (Parts 3 of
[`SEASON-LAUNCH.md`](SEASON-LAUNCH.md)).

Use this mode when the customer wants to verify the *real* pipeline: imported
games carry ESPN ids, so **Admin → Import → Sync Live Scores** exercises the
genuine grader against genuine data.

Switch back and forth freely during a session.

> After any reseed, sessions outlive the users they point at — the JWT is signed
> with a secret that survives the wipe. Tell testers to log out or open a fresh
> private window, or they'll see errors as a user that no longer exists.

---

## Requirements sign-off script

Give this to the customer, or drive it on a call. Each row is a rule the app
already enforces; the point is to confirm the customer actually wants it. Run it
in **`demo`** mode.

### The player experience

| # | What to do | What should happen | OK? |
| --- | --- | --- | --- |
| 1 | Log in as `jdog` / `password`, go to **Picks** | Week 4 is open, every team playing that week is selectable | ☐ |
| 2 | Pick a team | Selection reflects instantly, with a pop on the current-pick card | ☐ |
| 3 | Change to a different team | Allowed — neither game has kicked off yet | ☐ |
| 4 | Look at teams `jdog` used in weeks 1–3 | They show **Used** and can't be picked again all season | ☐ |
| 5 | Switch the week selector back to week 1 | Past weeks show ✓ win / ✗ loss / • pending markers | ☐ |
| 6 | Still as `jdog`, make a week-4 pick, then log out and back in as `mike_t` / `password`. Open **Leaderboard** | `jdog`'s week-4 pick is **hidden** — that game hasn't kicked off | ☐ |
| 7 | Toggle "Show Picks" on the leaderboard | `jdog`'s week-4 pick is *still* hidden — the toggle only reveals picks the server already released, it can't unmask anything | ☐ |
| 8 | Open **Stats** | Standings over time, lead changes, pick distribution, upsets, streaks | ☐ |
| 9 | Open the site on a phone | Hamburger nav, cards instead of tables, everything reachable one-handed | ☐ |
| 10 | Log in as `admin` and view the leaderboard | Admin sees **all** picks, including ones still hidden from players | ☐ |

### The rules themselves

Confirm the customer wants each of these, because they are built in:

| Rule | Behaviour | Agreed? |
| --- | --- | --- |
| One pick per week | Any team playing that week | ☐ |
| No reuse | A team is spent for the whole season once picked | ☐ |
| Per-game locking | Teams lock at *their own* kickoff, not one weekly deadline | ☐ |
| Pick changes | Allowed while both the old and new team's games are unstarted | ☐ |
| No elimination | A wrong pick scores nothing; you keep playing | ☐ |
| Regular season scoring | 1 point per correct pick, weeks 1–18 | ☐ |
| Playoff escalation | Wild Card 2, Divisional 3, Conference 4, Super Bowl 5 | ☐ |
| Team trophy | Average win percentage across a team's members; picks stay individual | ☐ |
| Usernames are permanent | Display names are freely editable; usernames are not | ☐ |

### The admin experience

Run this part in **`clean`** mode so they're doing the real thing.

| # | What to do | What should happen | OK? |
| --- | --- | --- | --- |
| 1 | **Admin → Season** → create season 2026 | 22 weeks built automatically with the right point values | ☐ |
| 2 | **Admin → Import** → import all weeks | Real NFL games load from ESPN, one line per week | ☐ |
| 3 | Note that late playoff weeks import 0 games | Expected — the NFL hasn't scheduled them yet | ☐ |
| 4 | **Admin → Teams** → create two teams | Appear immediately | ☐ |
| 5 | **Admin → Invites** → create a league link capped at 5 uses | Link generated; 6th registration is refused | ☐ |
| 6 | Register a new player through that link | Lands in the league, can pick | ☐ |
| 7 | **Admin → Teams** → assign players | Trophy standings update | ☐ |
| 8 | **Admin → Players → Emergency Password Reset** | Produces a temp password to hand over | ☐ |
| 9 | **Admin → Import → Sync Live Scores** | Pulls current ESPN scores and grades finished games | ☐ |

---

## Demo mode: play a whole week in one click

A beta runs for an hour. A season runs for five months. Demo mode closes that
gap: with `DEMO_MODE` on, the picks page grows a **Simulate week** button that
does everything a real weekend would.

```bash
./scripts/beta.sh seed demo-mode   # 2026 weeks 1-4 scheduled, nobody has picked yet
```

`DEMO_MODE` is already on in this stack (`docker-compose.beta.yml` defaults it
to `true`); set `DEMO_MODE=false` in `.env.beta` and restart to hide the
controls. **It is never set in production** — any signed-in user can press the
button, and it rewrites the week.

Walk the customer through it:

| # | What to do | What should happen | OK? |
| --- | --- | --- | --- |
| 1 | Log in as `admin` (or any player) and open **Picks** | Week 1 is open, with an amber **Demo** panel above the matchups | ☐ |
| 2 | Pick a team | Their pick appears; nobody else has picked yet | ☐ |
| 3 | Press **Simulate week** | Everyone else gets a random team, every game finishes, every pick is graded — in a couple of seconds | ☐ |
| 4 | Look at their own pick | Won or lost, with the points it scored | ☐ |
| 5 | Open **Leaderboard** | Everyone's picks are now visible (their games have kicked off) and the standings reflect the week | ☐ |
| 6 | Open **Stats** | Pick distribution, upsets, streaks — all computed from the week just played | ☐ |
| 7 | Back on **Picks**, select week 2 and press **Simulate 3 weeks** | Weeks 2–4 play out one after another, a week apart. Nobody is ever handed a team they already used | ☐ |
| 8 | Open **Stats** again | Now there's a season to look at: standings over time, lead changes week to week, streaks | ☐ |
| 9 | Switch the week selector across weeks 1–4 | Each week shows its own results; teams used in earlier weeks show **Used** and can't be picked again | ☐ |
| 10 | Press **Reset all weeks** | Every week reopens: picks cleared, scores gone, kickoffs back in the future, a week apart. Run the whole thing again as many times as they like | ☐ |

What the simulation does *not* fake is the grading: winners and losers are
decided by the same rules the live grader uses, including playoff point
escalation and the no-reuse rule (nobody is handed a team they already spent,
in any week of the run). The scores themselves are invented — the games aren't
real — but the betting line steers who wins, so favourites mostly hold and
upsets stay the exception, the way they do on a real Sunday.

A run covers as many consecutive scheduled weeks as you ask for — the panel
offers the whole scheduled stretch in one button (**Simulate 4 weeks** on a
fresh `demo-mode` seed). Each week is played out in its own transaction and
lands a week further back than the next, so what the customer ends up looking
at reads like a month of football rather than four slates on one afternoon.

It's still a demonstration tool, not a season simulator: the seeded schedule
stops at week 4, and the full-season simulator is a test harness (`pnpm
sim:season`, see the `testing-guide` skill).

> Demo mode acts on the week you have selected on the picks page. Simulating a
> week that's already been played out is a no-op on its scores — reset it first
> if you want different results.

### Known gaps (tracked separately)

- **The demo schedule stops at week 4** — enough to show a season developing,
  but the customer can't play through to the playoffs and see point escalation
  in action. (#163 delivered weeks 1–4.)
- **Games jump straight to final** — the live-scoring experience (green dot,
  scores ticking, teams locking one kickoff at a time) isn't demonstrated.
  (#164)
- **Only the picks page says "Demo"** — the leaderboard, stats and admin pages
  show simulated results with nothing marking them as fabricated. (#165)

## Other things a beta session can't wait for

Without demo mode, or on a week you'd rather not rewrite:

**Show a team locking at kickoff.** Pull the next game's kickoff into the past
and refresh the picks page — those two teams flip to "In progress" and become
unpickable, while every other team stays open. This is the clearest way to show
that locking is per-game, not per-week.

```bash
./scripts/beta.sh psql -c \
  "UPDATE \"Game\" SET kickoff = now() - interval '10 minutes', status = 'LIVE'
   WHERE id = (SELECT id FROM \"Game\" WHERE kickoff > now() ORDER BY kickoff LIMIT 1)
   RETURNING \"awayTeam\", \"homeTeam\";"
```

It prints the matchup it just started, so you know which two teams to point at.
(It targets whichever game is next rather than a named team — the demo week's
fixtures aren't the ones you'd guess.)

**Show pick visibility opening up.** Have one player pick a team in that game
*before* running the command above, then run it and refresh the leaderboard as a
different player: that pick is now visible, while everyone still on an unstarted
game stays hidden.

**Show grading against real data.** Demo mode grades with the real rules but
invented scores. To grade *real* games, use `clean` mode against the imported
schedule and hit **Sync Live Scores** — that's the ESPN pipeline end to end.
Either way, don't hand-write scores into the database to fake it: you'd be
demonstrating your SQL, not the app.

> The SQL above is a presentation shortcut that writes straight to the database
> and bypasses the app's own logic. Use it to *show* behaviour, never to *verify*
> it. Grading correctness is covered by the test suite — `pnpm test`, plus the
> ESPN fixture replay and the 22-week season simulator described in the
> `testing-guide` skill.

### Email (password resets, pick reminders)

With no SMTP configured — the default — the app writes reset links and reminder
emails to its log instead of sending them:

```bash
./scripts/beta.sh logs
```

That's usually the right call for a beta: testers can't receive mail at a
throwaway address, and you can read the reset link straight out of the log. To
demo real email, set the `SMTP_*` values in `.env.beta` and restart.

The beta stack deliberately does **not** run the reminders sidecar — its poll
interval is longer than most beta sessions. To fire one by hand, set
`CRON_SECRET` in `.env.beta`, restart, then:

```bash
curl -fsS -X POST "$(./scripts/beta.sh url)/api/admin/reminders/send" \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## LAN mode

If the customer is in the room, skip the tunnel entirely — nothing leaves your
network:

```bash
./scripts/beta.sh up --lan
```

Prints `http://<your-lan-ip>:3000`. If the host has several interfaces and it
picks the wrong one, override it:

```bash
BETA_LAN_IP=192.168.1.42 ./scripts/beta.sh up --lan
```

---

## Troubleshooting

**"Login works, then bounces me back to the login page."**
`NEXTAUTH_URL` doesn't match the origin in the browser's address bar, so the
session cookie is rejected. Almost always means the stack was restarted and got
a new tunnel hostname while someone kept using the old one. Run
`./scripts/beta.sh url` and re-send the current link.

**"The tunnel never reported a URL."**
This host can't reach Cloudflare outbound. Fall back to `--lan`.

**"The URL worked this morning and 404s now."**
Quick-tunnel hostnames are ephemeral and change on every restart. Re-send.

**"Port 3000 is already in use."**
Set `APP_PORT=3001` in `.env.beta` and run `up` again.

**"The app never became healthy."**
`./scripts/beta.sh logs app`. The usual cause is a `DATABASE_URL` in `.env.beta`
whose password doesn't match `POSTGRES_PASSWORD`.

**Start completely over:**

```bash
./scripts/beta.sh down --wipe    # deletes the beta database volume
./scripts/beta.sh up
```

---

## What this deliberately leaves out

Present these as "not tested here", not as gaps in the product — production has
all of them (`DEPLOYMENT.md`):

- **nginx + Let's Encrypt.** Cloudflare terminates TLS here instead.
- **Automated database backups.** Beta data is throwaway.
- **The reminders sidecar.** Triggered by hand above.
- **Uptime.** The stack lives as long as your machine stays awake.
