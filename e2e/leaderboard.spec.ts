import { test, expect } from "@playwright/test";
import { ADMIN, PLAYER1, loginAs } from "./helpers";

test.describe("Leaderboard", () => {
  test("shows players tab by default", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/leaderboard");
    await expect(page.getByRole("tab", { name: "Players" })).toBeVisible();
    await expect(page.locator("td").filter({ hasText: "Player One" })).toBeVisible();
  });

  test("player1 appears with 1 point from week 1 win", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/leaderboard");
    const row = page.locator("tr", { hasText: "Player One" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("1");
  });

  test("Show Picks toggle reveals week 1 pick (KC) for own user", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/leaderboard");
    // Wait for data to load before toggling picks
    await expect(page.locator("td").filter({ hasText: "Player One" })).toBeVisible();
    await page.getByRole("button", { name: "Show Picks" }).click();
    await expect(page.getByRole("cell", { name: "KC Win", exact: true })).toBeVisible();
  });

  test("Show Picks toggle persists across navigation", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/leaderboard");
    await expect(page.locator("td").filter({ hasText: "Player One" })).toBeVisible();
    await page.getByRole("button", { name: "Show Picks" }).click();
    await expect(page.getByRole("button", { name: "Hide Picks" })).toBeVisible();
    // Leave the leaderboard and come back — the toggle should still be on
    await page.goto("/picks");
    await page.goto("/leaderboard");
    await expect(page.getByRole("button", { name: "Hide Picks" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "KC Win", exact: true })).toBeVisible();
  });

  // Tie / push result on the leaderboard (#128). player1 is 1W/1T/1L in the
  // seed: week 1 win (KC), week 2 push (TEN, level game), week 3 loss (NYG).
  test("tied pick renders as '=' with an sr-only 'Tie'", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/leaderboard");
    await expect(page.locator("td").filter({ hasText: "Player One" })).toBeVisible();
    await page.getByRole("button", { name: "Show Picks" }).click();
    // The glyph itself is aria-hidden, so the cell's accessible name is the
    // team plus the sr-only word — status is never conveyed by glyph alone.
    await expect(page.getByRole("cell", { name: "TEN Tie", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "TEN Tie", exact: true })).toContainText("=");
    // The other side of the same level game (player2's pick) is a push too, and
    // is visible to player1 because that game has kicked off.
    await expect(page.getByRole("cell", { name: "JAX Tie", exact: true })).toBeVisible();
  });

  test("a push is excluded from win% (1W/1T/1L reads 50%)", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/leaderboard");
    const row = page.locator("tr", { hasText: "Player One" });
    await expect(row).toContainText("50%");
    // Counting the tie as a played game would read 33%; as a win, 67%.
    await expect(row).not.toContainText("33%");
    await expect(row).not.toContainText("67%");
    // And the tie scores nothing: the week-1 win is still the only point.
    await expect(row.locator("td").last()).toHaveText("1");
  });

  test("admin sees Team Trophy tab", async ({ page }) => {
    await loginAs(page, ADMIN.username, ADMIN.password);
    await page.goto("/leaderboard");
    await expect(page.getByRole("tab", { name: "Team Trophy" })).toBeVisible();
  });

  test("season selector is present and shows current season", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/leaderboard");
    // The select element itself is visible; options inside are always hidden in HTML
    const seasonSelect = page.locator("select").first();
    await expect(seasonSelect).toBeVisible();
    // The select should contain the current season year as a text value
    await expect(seasonSelect).toContainText("2025");
  });
});
