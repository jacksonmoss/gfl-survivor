import { test, expect } from "@playwright/test";
import { PLAYER1, loginAs } from "./helpers";

// Week 2 is the default selection on load: it has a future-kickoff game,
// so the picks page auto-advances to it.

test.describe("Picks", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
  });

  test("picks page shows season heading and week selector", async ({ page }) => {
    await expect(page.locator("text=2025 Season")).toBeVisible();
    await expect(page.locator("select")).toBeVisible();
  });

  test("week 2 matchups are visible", async ({ page }) => {
    // Week 2 is auto-selected on load
    await expect(page.getByRole("button", { name: /SF/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /DAL/ })).toBeVisible();
  });

  test("LAR and SEA buttons are disabled (game already started)", async ({ page }) => {
    // LAR vs SEA kicked off 2h ago
    await expect(page.getByRole("button", { name: /LAR/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /SEA/ })).toBeDisabled();
  });

  test("can submit a pick for a future game", async ({ page }) => {
    await page.getByRole("button", { name: /SF/ }).click();
    await page.waitForResponse("/api/picks");
    // Current pick summary banner appears. Scope to the exact banner label so we
    // don't also match the picked team button's "✓ Your pick" badge (the
    // optimistic update renders both immediately).
    await expect(page.getByText("Your pick", { exact: true })).toBeVisible();
    // Week 2 in the selector should now show a "Picked" badge
    const weekOption = page.locator("select option").filter({ hasText: "Week 2" });
    await expect(weekOption).toContainText("Picked");
  });

  test("can change a pick to another future game", async ({ page }) => {
    // Ensure SF is picked first (may already be from prior test)
    await page.getByRole("button", { name: /SF/ }).click();
    await page.waitForResponse("/api/picks");
    // Change to DAL
    const dalBtn = page.getByRole("button", { name: /DAL/ });
    await expect(dalBtn).not.toBeDisabled();
    await dalBtn.click();
    await page.waitForResponse("/api/picks");
    await expect(page.getByText("Picked Dallas Cowboys")).toBeVisible();
  });

  test("week 1 pick is shown in season history", async ({ page }) => {
    await page.getByRole("button", { name: /Season picks/ }).click();
    // History table shows full names; use cell role to avoid matching <select> options
    await expect(page.getByRole("cell", { name: /Week 1/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /Kansas City/ })).toBeVisible();
  });

  test("upcoming matchup shows a kickoff time with a timezone label", async ({ page }) => {
    // SF vs DAL kicks off in 5 days (not started), so its card shows the kickoff
    // time rather than "In progress". The time must carry a zone token so the
    // viewer knows it's their local time (#90). Zone label is a short abbr
    // (e.g. PDT/EST/UTC) or a GMT±offset, depending on the runtime timezone.
    const card = page.locator("div.overflow-hidden.rounded-xl").filter({
      has: page.getByRole("button", { name: /^SF\b/ }),
    });
    await expect(card).toContainText(/\d{1,2}:\d{2}\s?(AM|PM).*\b(?:[A-Z]{2,5}|GMT[+-]\d{1,2})\b/);
  });
});

// Weather / dome strip on the matchup cards (#69). Fixtures are seeded in
// prisma/seed-e2e.ts: GB (outdoor, cached forecast), LAR (dome, no weather),
// SF (outdoor, beyond the 72h window so it's never fetched → no strip).
test.describe("Weather / dome strip", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
  });

  // The matchup card containing a given team's button (abbr is first in the
  // button's accessible name, so anchor on it).
  const cardFor = (page: import("@playwright/test").Page, abbr: string) =>
    page.locator("div.overflow-hidden.rounded-xl").filter({
      has: page.getByRole("button", { name: new RegExp(`^${abbr}\\b`) }),
    });

  test("outdoor game with cached weather shows the forecast strip", async ({ page }) => {
    await expect(cardFor(page, "GB")).toContainText("41°F · Wind 22mph NW · 70% precip");
  });

  test("dome game shows the Dome indicator", async ({ page }) => {
    await expect(cardFor(page, "LAR")).toContainText("Dome");
  });

  test("outdoor game without cached weather shows no strip", async ({ page }) => {
    const sf = cardFor(page, "SF");
    await expect(sf).toBeVisible();
    await expect(sf).not.toContainText("°F");
    await expect(sf).not.toContainText("Dome");
  });
});

// Betting-spread strip on the matchup cards (#72). Fixtures are seeded in
// prisma/seed-e2e.ts: GB vs CHI carries spreadHome = -6.5 (GB favored), so the
// home side renders "-6.5" and the away side "+6.5"; SF vs DAL has no spread, so
// its card renders no strip. Spreads come straight from the seeded
// Game.spreadHome — no live Odds API call.
test.describe("Betting-spread strip", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
  });

  const cardFor = (page: import("@playwright/test").Page, abbr: string) =>
    page.locator("div.overflow-hidden.rounded-xl").filter({
      has: page.getByRole("button", { name: new RegExp(`^${abbr}\\b`) }),
    });

  test("game with a seeded spread shows favorite and underdog lines", async ({ page }) => {
    const card = cardFor(page, "GB");
    // Each side renders its spread in a div[title="Vegas spread"]: GB -6.5, CHI +6.5.
    const spreads = card.locator('[title="Vegas spread"]');
    await expect(spreads).toHaveCount(2);
    await expect(card).toContainText("-6.5");
    await expect(card).toContainText("+6.5");
  });

  test("game without a spread shows no spread line", async ({ page }) => {
    const card = cardFor(page, "SF");
    await expect(card).toBeVisible();
    await expect(card.locator('[title="Vegas spread"]')).toHaveCount(0);
  });
});
