# GFL Survivor — Season Launch Plan

How to put the app on a server and open it to players for a new NFL season.

This is written for a **fresh install on the customer's server**, split by who
does what:

| Part | Who | Where | Time |
| --- | --- | --- | --- |
| [Part 1 — Before deploy day](#part-1--before-deploy-day) | You + customer | Email/phone | 15 min, done in advance |
| [Part 2 — Install the app](#part-2--install-the-app) | **You** | Terminal on their server | ~45 min |
| [Part 3 — Open the league](#part-3--open-the-league) | **Customer** | Web browser | ~20 min |
| [Part 4 — During the season](#part-4--during-the-season) | **Customer** | Web browser | A few minutes a week |
| [Part 5 — When something looks wrong](#part-5--when-something-looks-wrong) | Customer, then you | Both | — |

`DEPLOYMENT.md` is the engineering reference for the same stack — how the
containers fit together, TLS internals, restore procedure. This document is the
runbook: what to do, in order, on the day.

---

## Part 1 — Before deploy day

Nothing here needs a terminal. Collect these five things first; missing any one
of them stops Part 2 partway through.

### 1. A server

Anything with **2 GB RAM, 2 CPU cores, and 20 GB of disk** is comfortable. This
app is small — a $12/month VPS runs it fine. It needs:

- A recent Linux (Ubuntu 22.04/24.04 is the safe pick)
- **Docker** with the Compose plugin installed
- SSH access for you, with `sudo`
- **Ports 80 and 443 open** to the public internet

> **Why ports 80 and 443:** 443 is how players reach the site. 80 is how the free
> security certificate gets issued and renewed automatically. If the customer's
> IT closes port 80, certificates stop renewing and the site breaks with a
> browser warning about three months later. Get this confirmed in writing now.

### 2. A domain name

Something like `gflsurvivor.com`. The customer buys it (~$12/year) and owns it —
don't register it under your account, or renewal becomes your problem forever.

Point it at the server with a **DNS "A record"**: name `@` (or the subdomain),
value = the server's public IP address. This is a form on the domain
registrar's website, not a technical task.

Do this **at least a day early**. DNS changes take anywhere from minutes to
several hours to spread across the internet, and the certificate step in Part 2
fails if it hasn't finished.

### 3. An email sending account (recommended)

Used for password resets and pick reminders. Without it the app still works —
players just can't reset their own passwords, and the customer has to hand out
temporary ones by text.

Easiest options: **SendGrid**, **Mailgun**, or **Amazon SES** — all have free
tiers well above what a league of 10–30 people needs. You need five values from
them: host, port, username, password, and the "from" address.

> Don't use a personal Gmail password here. Gmail requires an app-specific
> password and will silently rate-limit or block bulk sending, which shows up as
> "some people got the reminder and some didn't."

### 4. An odds API key (optional)

Free key from [the-odds-api.com](https://the-odds-api.com/) puts betting spreads
(`-6.5`, `+6.5`, `PK`) on the matchup cards. Free tier is 500 requests/month; the
app uses far fewer. Skip it and the cards simply have no spread line — nothing
breaks.

### 5. Decide the league rules the app assumes

Confirm the customer actually wants these, because they're built in:

- One pick per week, any team playing that week
- **A team can only be used once all season**
- Teams lock individually at their own kickoff, not at one weekly deadline
- Wrong picks don't eliminate you — you just get no points
- Regular season = 1 point; playoffs escalate 2 / 3 / 4 / 5 points
- Team trophy is based on average win percentage across a team's members

**Pre-flight checklist:**

- [ ] Server exists, Docker installed, you can SSH in
- [ ] Ports 80 and 443 confirmed open
- [ ] Domain purchased **by the customer**
- [ ] DNS A record pointed at the server, done ≥24h early
- [ ] Email account created, 5 SMTP values in hand
- [ ] Odds API key (optional)
- [ ] Customer has confirmed the rules above

---

## Part 2 — Install the app

**You do this.** SSH into the customer's server. Roughly 45 minutes, most of it
waiting on the build.

### Step 1 — Get the code

```bash
git clone https://github.com/jacksonmoss/gfl-survivor.git
cd gfl-survivor
```

### Step 2 — Write the settings file

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Fill in every line below. Generate the two secrets with the commands shown — do
not invent them by hand, and do not reuse them from another install.

```bash
POSTGRES_PASSWORD=<a long random password>
DATABASE_URL=postgresql://gfl:<that same password>@db:5432/gfl?schema=public

DOMAIN=gflsurvivor.com
CERTBOT_EMAIL=customer@theiremail.com

NEXTAUTH_URL=https://gflsurvivor.com
NEXTAUTH_SECRET=<paste: openssl rand -base64 32>

CRON_SECRET=<paste: openssl rand -hex 32>

SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=<the key>
SMTP_FROM=GFL Survivor <no-reply@gflsurvivor.com>

# ODDS_API_KEY=<optional>
```

Three ways this goes wrong, all of which produce confusing failures later:

- **The password in `DATABASE_URL` must exactly match `POSTGRES_PASSWORD`.** If
  they differ you get `P1000: Authentication failed` and the app never starts.
- **`NEXTAUTH_URL` must start with `https://` and have no trailing slash.** Get
  this wrong and login appears to work but immediately bounces back to the login
  page, because the session cookie is rejected.
- **`NEXTAUTH_SECRET` cannot be blank.** The app deliberately refuses to start
  without it rather than running insecurely.

### Step 3 — Get the security certificate

DNS must already be pointing at this server.

```bash
./deploy/init-letsencrypt.sh
```

This is the one step worth rehearsing. Let's Encrypt **rate-limits failures to 5
per hour per domain**, so if it fails you may be locked out for an hour. Test
first against their staging service, which is unlimited:

```bash
STAGING=1 ./deploy/init-letsencrypt.sh   # rehearsal — expect a browser warning
./deploy/init-letsencrypt.sh             # the real one
```

If it fails, it's almost always DNS not having propagated yet. Confirm with
`dig +short gflsurvivor.com` — it must print the server's IP.

### Step 4 — Start everything

```bash
docker compose -p gfl-prod -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

First build takes 5–10 minutes. Later ones are much faster.

> **Always include `-p gfl-prod`.** Every command in this file has it. Without
> it, Docker names the project after the folder and the production database can
> collide with a development one on the same machine. Safest fix: add
> `COMPOSE_PROJECT_NAME=gfl-prod` to `.env.prod` so it's automatic.

### Step 5 — Create the first admin account

```bash
docker compose -p gfl-prod -f docker-compose.prod.yml --env-file .env.prod \
  run --rm migrate pnpm seed
```

This prints an admin username and password, plus five invite codes.

> ### ⚠️ The seeded password is `admin123` — change it before you do anything else
>
> This is a known, published default on a server that is now reachable from the
> open internet. Log in at `https://<domain>/login` as `admin` / `admin123`, go
> to **Settings → Password**, and change it immediately. Do not skip this, do not
> leave it until after the handover call.
>
> Note that **usernames cannot be changed** in the app by design. The customer
> will log in as `admin` permanently — only the password changes. If they want a
> different admin username, tell me before this step and I'll create it directly.

### Step 6 — Verify it's actually working

```bash
curl -fsS https://gflsurvivor.com/api/health     # must print {"ok":true}
docker compose -p gfl-prod -f docker-compose.prod.yml ps
```

Every service should read `running`; `app` should read `healthy`. Then open the
site in a real browser and confirm the padlock icon appears with no warning.

**Do not hand over until all four are true:**

- [ ] `/api/health` returns `{"ok":true}`
- [ ] Padlock shows in the browser, no certificate warning
- [ ] Admin password has been changed off `admin123`
- [ ] You've logged in as admin successfully

---

## Part 3 — Open the league

**The customer does this, in a web browser. No terminal, nothing to install.**

Everything below lives under the **Admin** link in the top navigation, which only
admins can see. Work through the tabs left to right.

### Step 1 — Create the season

**Admin → Season tab → Create Season.** Enter the year (**2026**) and submit.

This builds all 22 weeks automatically: 18 regular-season weeks worth 1 point
each, then Wild Card (2 pts), Divisional (3), Conference Championship (4), and
Super Bowl (5).

### Step 2 — Load the NFL schedule

**Admin → Import tab.** Select the 2026 season, tick **"import all weeks"**, and
click **Import**.

The app pulls every game — teams, dates, kickoff times — straight from ESPN. It
prints one line per week telling you how many games it imported.

> Some later weeks may import 0 games. That's normal and not an error: the NFL
> hasn't scheduled playoff matchups yet, since nobody knows who's in them. Re-run
> this same import in January and the playoff weeks fill in.

### Step 3 — Create the teams

**Admin → Teams tab → Create Team.** Add one for each squad in the league (the
demo uses "The Dawgs", "Gridiron Gang", "Lone Wolves").

Teams are only for the **team trophy**, which averages win percentage across a
team's members. Everyone still picks individually — being on a team never
changes anyone's own picks or score. Players who aren't on a team still play
normally; they just don't count toward a trophy.

### Step 4 — Invite the players

**Admin → Invites tab.** Two options:

- **League Invite Link** — one link everyone uses. Optionally cap it (e.g. 20
  uses) so a forwarded link can't let in strangers. This is the easy choice for
  a group text.
- **Single-Use Codes** — one code per person, each works exactly once. Use this
  if the league is invite-only and you want to control precisely who joins.

Send it out. Players register themselves — pick a username and password, and
optionally an email address.

> **Tell players to add their email.** It's the only way they can reset their own
> password. Without it, the customer has to issue a temp password by hand from
> **Admin → Players → Emergency Password Reset** every time somebody forgets.

### Step 5 — Assign players to teams

Once people have registered: **Admin → Teams → Assign Player to Team.**

Do this before Week 1 kicks off. Rosters lock at the season's first kickoff, and
they carry forward automatically if a 2027 season is created later.

**Launch checklist:**

- [ ] 2026 season created
- [ ] Schedule imported, Week 1 shows real games
- [ ] Teams created
- [ ] Invite link or codes sent
- [ ] Everyone registered
- [ ] Players assigned to teams
- [ ] Admin password is no longer `admin123`

---

## Part 4 — During the season

The honest answer: **almost nothing.** The app updates scores, grades picks,
sends reminders, and backs itself up without being asked.

**What runs on its own:**

| Job | How often |
| --- | --- |
| Pull live scores from ESPN and grade picks | Continuously during games |
| Email players who haven't picked yet | ~3h before Thursday and Sunday kickoffs |
| Refresh weather and betting spreads | Automatically before kickoff |
| Back up the database | Daily, keeping the last 7 |
| Renew the security certificate | Automatically, every 12h check |

**What the customer actually does:**

- **Nothing weekly.** Picks grade themselves once games go final.
- **In January**, re-run the schedule import (Part 3, Step 2) so playoff
  matchups load once the bracket is set.
- **When someone forgets their password:** if they registered an email, they
  click "Forgot your password?" themselves. If not: **Admin → Players →
  Emergency Password Reset** generates a temp password to hand them directly.
- **Next season:** create a 2027 season in the Season tab. Team rosters copy
  forward automatically, so players stay on their teams. Then import the 2027
  schedule.

---

## Part 5 — When something looks wrong

### For the customer — check these first

**"The site won't load at all."**
Try a phone on cell data, not office WiFi. If it loads there, it's their local
network or DNS, not the app. If it loads nowhere, call you.

**"Scores aren't updating."**
Games go final on ESPN before the app sees it — allow a few minutes. Refresh the
page. Admin can force it with **Admin → Import → Sync Live Scores**.

**"A player says they can't pick a team."**
Almost always one of three by-design reasons, not a bug:
1. They already used that team this season (shows **Used**)
2. That game already kicked off (shows **In progress**)
3. Their current pick's game already started, so it's locked in

**"Nobody got a reminder email."**
Check the email account's dashboard for bounces or a rate limit first — that's
the usual cause.

**"Someone forgot their password and has no email on file."**
**Admin → Players → Emergency Password Reset.**

### For you — the technical checks

```bash
cd gfl-survivor
docker compose -p gfl-prod -f docker-compose.prod.yml ps
docker compose -p gfl-prod -f docker-compose.prod.yml logs -f app
docker compose -p gfl-prod -f docker-compose.prod.yml logs -f reminders
curl -fsS https://gflsurvivor.com/api/health
```

**Restart everything** (safe; no data loss):

```bash
docker compose -p gfl-prod -f docker-compose.prod.yml --env-file .env.prod up -d
```

**Deploy an update:**

```bash
git pull
docker compose -p gfl-prod -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Database migrations run automatically before the app restarts.

**Check backups are real:**

```bash
ls -lt backups/
```

> Backups land in `./backups` **on the same server**. That survives a bad
> migration or a dropped table — it does **not** survive the server itself dying.
> If the customer would be upset to lose the season's history, sync that folder
> off-host (S3, Backblaze, even a nightly `rsync` elsewhere). Say this out loud
> at handover; it's the gap most likely to bite.

Restore instructions are in `DEPLOYMENT.md` → *Back up / restore the database*.

---

## Handover checklist

Give the customer:

- [ ] The site URL
- [ ] Admin username (`admin`) and the **new** password
- [ ] This document, Parts 3–5
- [ ] Who to call, and what counts as urgent (site down) vs. can-wait (a player
      can't log in)

Keep for yourself, somewhere safe and **not** in this repo:

- [ ] Server SSH access details
- [ ] A copy of `.env.prod` — it contains every secret and is not recoverable
- [ ] Domain registrar login (customer's account, you may need access)
- [ ] Email and odds API accounts

### Known limitations worth stating up front

Better said now than discovered in October:

- **Usernames can't be changed** after registration, by design. Display names
  can be, freely.
- **The certificate covers one exact domain.** `gflsurvivor.com` and
  `www.gflsurvivor.com` are different names — pick one and use it everywhere
  ([#81](https://github.com/jacksonmoss/gfl-survivor/issues/81)).
- **This runs on one server.** No automatic failover; if it goes down, it's down
  until someone restarts it.
- **Playoff schedules don't exist yet** in August. January import is required.
