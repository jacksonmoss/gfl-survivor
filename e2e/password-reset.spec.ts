import { test, expect } from "@playwright/test";

test.describe("Password reset", () => {
  test("forgot-password page renders and accepts submission", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.locator("h1").first()).toBeVisible();
    // Input has id="identifier" and type="text" (accepts username or email)
    await page.fill("#identifier", "player1@example.com");
    await page.click('button[type="submit"]');
    // Always shows success regardless of whether account exists (no enumeration)
    await expect(
      page.locator("text=If an account with an email on file matches")
    ).toBeVisible();
  });

  test("reset-password page without token shows error", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(
      page.locator("text=Missing reset token")
    ).toBeVisible();
  });

  test("reset-password page with invalid token shows error after submit", async ({ page }) => {
    await page.goto("/reset-password?token=invalidtoken");
    // Page loads the form (token is in URL)
    await page.fill("#password", "newpassword");
    await page.fill("#confirm", "newpassword");
    await page.click('button[type="submit"]');
    // API returns "This reset link is invalid or has expired"
    await expect(
      page.locator("text=invalid or has expired")
    ).toBeVisible();
  });
});
