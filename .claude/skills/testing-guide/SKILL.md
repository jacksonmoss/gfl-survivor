---
name: testing-guide
description: GFL test-suite deep dives: the DB-backed season simulator (pnpm sim:season), the invite-cap concurrency test, ESPN fixture replay/recording, and the Playwright E2E suite. Use when writing or debugging integration tests, E2E specs, or regenerating fixtures.
---

# Testing deep dives

### DB-backed full-season simulator (#108)

`prisma/sim-season.ts` (run with `pnpm sim:season`) plays a whole 22-week season through the **real Prisma schema and the real grading lib** (`computeAllGameUpdates`), not an in-memory re-implementation — so the *workflow* (season create → weekly picks honoring the no-reuse rule → FINAL ESPN payload → grade → totals/trophy) is proven, not just the arithmetic. It seeds the 22 weeks via the shared `buildSeasonWeeks` helper (#107), 10 players + 3 trophy teams, and a deterministic seeded schedule (round-robin regular season, all 32 teams once/week; a reserved 12-team playoff pool so every player reaches week 22 with unused bracket teams available). Home always wins in the playoffs so each round (2/3/4/5 pt) reliably grades a WIN. The CLI logs a per-week play-by-play + final standings/trophy and exits non-zero on any invariant violation. It only ever touches a **disposable** DB (`assertSafeSimUrl` refuses the dev DB / `postgres`); default `gfl_sim`, override with `SIM_DATABASE_URL`.

The same invariants run as a Vitest integration test (`src/__tests__/sim-season.integration.test.ts`) so CI catches regressions — it's **gated on `SIM_DATABASE_URL`** (`describe.skipIf`), so a plain `pnpm test` (no DB) skips it and never touches dev data. A dedicated workflow (`.github/workflows/sim.yml`, separate from `ci.yml`) provides a throwaway Postgres and sets the env; it runs **every** `*.integration.test.ts` (`vitest run integration.test`) — today the season sim plus the invite-cap concurrency test (#123, below). Because these are heavier than the unit tests, it's gated by a **paths filter** — it runs on PRs *and* pushes to dev/master, but only when a file that could change the outcome is touched (`prisma/sim-season.ts`, `prisma/schema.prisma`, `prisma/migrations/**`, `src/lib/{season,score-sync,espn,nfl-teams,invites,invite-claim}.ts`, the register route, the integration tests, `pnpm-lock.yaml`, or the workflow itself). Paths filters must live at the workflow trigger level, which is why this is its own file rather than a job in `ci.yml`. The fast `season.test.ts` still guards the pure logic on every PR. Run locally with `SIM_DATABASE_URL=postgresql://gfl:gfl_dev_password@localhost:5433/gfl_sim pnpm test sim-season`. This is **part A** of the season dry-run plan; **part B** (replaying the grader against captured real ESPN fixtures) is the ESPN fixture replay below (#109). **When you add or change logic, extract it to a `lib/` helper and unit-test it in the same change — don't leave it inline in the route and don't defer coverage to a follow-up ticket.** API routes aren't unit-tested directly (they depend on Prisma/NextAuth); the E2E suite exercises them through the UI instead.

### Invite-cap concurrency test (#123)

`src/__tests__/invite-claim.integration.test.ts` proves the multi-use invite cap holds under real concurrency: it fires N simultaneous `claimInviteAndCreateUser` calls at a cap-M league code and asserts exactly M succeed (and that the *DB* row count agrees, not just the returned results), plus single-use admitting exactly one, an uncapped code admitting everyone, and a username collision between racers returning the "taken" 400 instead of a P2002 crash. This can't be a unit test — the race lives between "count the uses" and "create the user", so it needs a real Postgres. **Verified to fail against the pre-#123 code** (8/8 claims succeeded on a cap-3 code without the row lock).

Same gating as the season sim (`SIM_DATABASE_URL` + `describe.skipIf`), but pointed at its **own** throwaway DB (`gfl_invite_test`, derived from the URL) so the two files can run in parallel without fighting over one schema. Run locally with `SIM_DATABASE_URL=postgresql://gfl:gfl_dev_password@localhost:5433/gfl_sim pnpm test invite-claim`.

### ESPN fixture replay (#109) — part B of the season dry-run

`src/__tests__/espn-replay.test.ts` replays a **real completed season** (2024) through the *actual* ESPN parser + grader (`computeAllGameUpdates`/`computeGameUpdate`), catching the breaks synthetic data (#108) can't: the regular→playoff `seasonType`/week transition (`getESPNWeekParams`), the Super-Bowl `espnWeek=5` quirk (ESPN skips 4 for the Pro Bowl), and team-abbr edge cases (ESPN `WSH` → our `WAS`). Fixtures live in `fixtures/espn/2024-<seasonType>-<espnWeek>.json` — **one committed JSON per (year, seasonType, espnWeek)**, 22 files, ~300KB total. They're **not raw ESPN dumps**: the recorder projects each payload down to exactly the fields the parser navigates (event/competition ids, date, `status.type`, competitors' `homeAway`/abbr/`displayName`/`score`/`winner`), copied verbatim, which is ~10× smaller (raw is ~140KB/week) yet drives the identical parse path. The test is **network-free** (fixtures only) and runs in the normal `pnpm test`.

Key assertions: every week parses and every FINAL game produces exactly one graded transition; each game's score-derived winner equals ESPN's own `winner:true` flag (mapped through `mapTeamAbbr`), i.e. all 285 grades match the known 2024 results; the four playoff rounds map correctly and shrink 6→4→2→1; a real `WSH`-win grades as `WAS`; the Super Bowl grades PHI over KC. The **tie** case is pinned with a synthetic FINAL event: since #113 a level game grades as a **push** (`isTie`, no winner/loser), so the test asserts `winnerTeam`/`losingTeam` are null and `isTie` is set. (Before #113 this pinned the old bug — an equal score fell to the away branch and graded the away team the winner.)

Regenerate fixtures with `pnpm record:espn` (`scripts/record-espn-season.ts`; `YEAR=2023 pnpm record:espn` for another season). It's a **one-off recorder** — the only step that hits the live ESPN API — using the same `buildESPNUrl`/`getESPNWeekParams` the sync route does, so fixture filenames map 1:1 to real ESPN queries. Not part of CI.

### End-to-end (Playwright)

The `e2e/` suite drives the **real UI** in a browser — use it (or extend a spec) when a change touches a page/flow.

```
e2e/
├── global-setup.ts     # drops/recreates a throwaway `gfl_e2e` DB, runs migrate deploy + seed-e2e
├── helpers.ts          # ADMIN/PLAYER1 creds, loginAs(page, ...)
├── auth.spec.ts        # login/register/logout + multi-use league invite (many users, one code — #110) + ?invite= link prefill (#111) + username-only signup (#112)
├── picks.spec.ts       # pick submit/change/lock + weather/dome strip (#69) + betting-spread strip (#72) + kickoff TZ label (#90)
├── leaderboard.spec.ts # standings + team trophy
├── settings.spec.ts    # profile first/last name round-trip + display-name fallbacks (#126); restores player1's seeded profile so later specs still see "Player One"
├── z-admin.spec.ts     # admin panel: invites (single-use + league link rotate — #110), season create, team create + rename, season-scoped roster lock → override → assign → trophy (#120)
├── password-reset.spec.ts
└── mobile.spec.ts      # runs only under the `mobile` project (iPhone 14 viewport)
```

- Run all: `pnpm test:e2e` (Playwright's `webServer` runs `PORT=3001 pnpm start`, so **a production build must exist** — run `pnpm build` first; `reuseExistingServer` is on outside CI).
- One spec/test: `pnpm exec playwright test z-admin.spec.ts --project=desktop -g "rename a team"`.
- Two projects (`playwright.config.ts`): `desktop` (Desktop Chrome, ignores `mobile.spec.ts`) and `mobile` (Chromium with iPhone 14 viewport, only `mobile.spec.ts`).
- Vitest ignores `e2e/**`; the E2E DB (`gfl_e2e`) is separate from the dev DB and rebuilt on every run, so tests can freely create/rename/delete.
- Selector gotcha: a team name renders both as a roster-card `<span>` **and** as an `<option>` in the "Assign Player" `<select>` — scope UI assertions to the card (e.g. filter by the card's Rename button) so `getByText` doesn't match two elements.
- Race gotcha: a client page that hydrates empty and fills its inputs from a `useEffect` fetch (Settings) will **overwrite anything typed before the response lands**. Assertions auto-retry, so they're safe; `fill()` isn't. Wait for the fetch first (`page.waitForResponse` — see `openSettings` in `settings.spec.ts`), not just for the input to be visible.
- Specs run **serially in file order** (`workers: 1`, `fullyParallel: false`), so a spec that mutates seeded data other specs assert on must restore it (`settings.spec.ts` resets player1's profile; `z-admin.spec.ts` is `z`-prefixed to run last).
