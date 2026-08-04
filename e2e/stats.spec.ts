import { test, expect } from "@playwright/test";
import { PLAYER1, loginAs } from "./helpers";

// Stats page (#121). The E2E seed gives weeks 1–3 as completed (wk1 KC win,
// wk2 TEN/JAX tie, wk3 NYG loss) and week 4 in progress with a pre-kickoff
// DAL pick — which is the leak fixture the visibility tests below lean on.
test.describe("Stats", () => {
  test("is reachable from the navbar by a non-admin", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.getByRole("link", { name: "Stats" }).first().click();
    await page.waitForURL("/stats");
    await expect(page.getByRole("heading", { name: "Stats", level: 1 })).toBeVisible();
  });

  test("shows season-to-date totals over the completed weeks only", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/stats");

    // Weeks 1–3 are final; week 4 is still in progress and must not count.
    const weeksPlayed = page.locator("div", { hasText: /^Weeks played$/ }).locator("..");
    await expect(weeksPlayed).toContainText("3");

    // 4 counted picks: wk1 KC win, wk2 TEN + JAX pushes, wk3 NYG loss.
    // Pushes are excluded from the rate, so 1W/1L reads 50%.
    await expect(page.getByText("Picks made")).toBeVisible();
    await expect(page.getByText("Pool hit rate")).toBeVisible();
    await expect(page.locator("div", { hasText: /^Pool hit rate$/ }).locator("..")).toContainText("50%");
  });

  test("lists most-picked teams with their record", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/stats");
    const card = page.locator("div").filter({ has: page.getByRole("heading", { name: "Most-picked teams" }) }).last();
    await expect(card).toContainText("KC");
    await expect(card).toContainText("Kansas City Chiefs");
  });

  test("opens on the most recent completed week", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/stats");
    await expect(page.getByLabel("Select week")).toHaveValue("3");
    await expect(page.getByText("1 player lost")).toBeVisible();
  });

  test("the first completed week has no lead-change section", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/stats");
    await page.getByLabel("Select week").selectOption("1");
    await expect(page.getByText("First completed week — no prior standings")).toBeVisible();
  });

  // The visibility guarantee: an in-progress week is never published, so a pick
  // made on a game that hasn't kicked off can't be inferred from the stats.
  test("an in-progress week is not offered and its picks do not leak", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/stats");
    await expect(page.getByLabel("Select week")).toBeVisible();

    const weeks = await page.getByLabel("Select week").locator("option").allTextContents();
    expect(weeks).toEqual(["Week 3", "Week 2", "Week 1"]);

    // player2's week-4 pick is on DAL, whose game is 5 days out.
    await expect(page.getByText("DAL")).toHaveCount(0);
  });
});
