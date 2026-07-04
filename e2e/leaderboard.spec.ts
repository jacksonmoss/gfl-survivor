import { test, expect } from "@playwright/test";
import { ADMIN, PLAYER1, loginAs } from "./helpers";

test.describe("Leaderboard", () => {
  test("shows players tab by default", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/leaderboard");
    await expect(page.getByRole("button", { name: "Players" })).toBeVisible();
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
    await expect(page.getByRole("cell", { name: "KC ✓", exact: true })).toBeVisible();
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
    await expect(page.getByRole("cell", { name: "KC ✓", exact: true })).toBeVisible();
  });

  test("admin sees Team Trophy tab", async ({ page }) => {
    await loginAs(page, ADMIN.username, ADMIN.password);
    await page.goto("/leaderboard");
    await expect(page.getByRole("button", { name: "Team Trophy" })).toBeVisible();
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
