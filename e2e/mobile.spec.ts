import { test, expect } from "@playwright/test";
import { PLAYER1, loginAs } from "./helpers";

// These tests run under the "mobile" project (playwright.config.ts) with
// Chromium + iPhone 14 viewport. They mirror golden-path flows to catch
// mobile-specific regressions.

test.describe("Mobile — golden paths", () => {
  test("login page renders on mobile", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#username")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("hamburger menu opens navigation", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    // The hamburger button has class sm:hidden (only visible on mobile)
    const hamburger = page.locator('button[class*="sm:hidden"]');
    await hamburger.click();
    await expect(page.getByRole("link", { name: "Leaderboard" })).toBeVisible();
  });

  test("picks page renders on mobile", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    // Match any year (the active season may have changed due to admin tests)
    await expect(page.locator("text=/\\d{4} Season/")).toBeVisible();
    await expect(page.locator("select")).toBeVisible();
  });

  test("leaderboard renders on mobile", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await page.goto("/leaderboard");
    await expect(page.locator("h1")).toContainText("Leaderboard");
    // Use table context to avoid matching the navbar's user name
    await expect(page.getByRole("table").getByText("Player One")).toBeVisible();
  });
});
