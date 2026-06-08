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
    // Current pick summary banner appears
    await expect(page.locator("text=Your pick")).toBeVisible();
    // Week 2 in the selector should now show a pending bullet
    const weekOption = page.locator("select option").filter({ hasText: "Week 2" });
    await expect(weekOption).toContainText("•");
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
});
