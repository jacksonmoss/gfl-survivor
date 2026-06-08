import { test, expect } from "@playwright/test";
import { ADMIN, PLAYER1, loginAs } from "./helpers";

test.describe("Admin panel", () => {
  test("Admin nav link is not shown for non-admin users", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await expect(page.getByRole("link", { name: "Admin" })).not.toBeVisible();
  });

  test("admin can access the admin page", async ({ page }) => {
    await loginAs(page, ADMIN.username, ADMIN.password);
    await page.goto("/admin");
    await expect(page).toHaveURL("/admin");
    await expect(page.locator("h1")).toContainText("Admin");
  });

  test("admin can generate an invite code", async ({ page }) => {
    await loginAs(page, ADMIN.username, ADMIN.password);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Invites" }).click();
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.locator("text=New invite code")).toBeVisible();
  });

  test("admin can create a new season", async ({ page }) => {
    await loginAs(page, ADMIN.username, ADMIN.password);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Season" }).click();
    const yearInput = page.locator('input[type="number"]');
    await yearInput.fill("2026");
    // Button text is "Create", inside the "Create Season" section
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("text=2026")).toBeVisible();
  });
});
