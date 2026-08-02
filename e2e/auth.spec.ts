import { test, expect } from "@playwright/test";
import { ADMIN, PLAYER1, loginAs } from "./helpers";

test.describe("Authentication", () => {
  test("unauthenticated visit redirects to /login", async ({ page }) => {
    await page.goto("/picks");
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong password shows error", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#username", PLAYER1.username);
    await page.fill("#password", "wrongpassword");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Invalid username or password")).toBeVisible();
  });

  test("correct credentials redirect to /picks", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await expect(page).toHaveURL("/picks");
  });

  test("admin can log in and sees Admin nav link", async ({ page }) => {
    await loginAs(page, ADMIN.username, ADMIN.password);
    await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
  });

  test("sign out returns to /login on the same origin", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    const origin = new URL(page.url()).origin;
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    // Must stay on the origin we loaded (regression guard for #78: signOut's
    // default redirect resolved the callbackUrl against NEXTAUTH_URL and could
    // send a non-localhost origin to localhost).
    expect(new URL(page.url()).origin).toBe(origin);
    // Session is gone: a protected route bounces back to login.
    await page.goto("/picks");
    await expect(page).toHaveURL(/\/login/);
  });

  test("register with valid invite code then log in", async ({ page }) => {
    await page.goto("/register");
    await page.fill("#inviteCode", "E2EINVITE1");
    await page.fill("#displayName", "New Player");
    await page.fill("#username", "newplayer1");
    await page.fill("#password", "newpass123");
    await page.click('button[type="submit"]');
    // Should redirect to login after successful registration
    await expect(page).toHaveURL(/\/login/);

    await page.fill("#username", "newplayer1");
    await page.fill("#password", "newpass123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/picks");
  });

  test("multiple users register with the same league invite code", async ({ page }) => {
    // Multi-use code (#110): unlike a single-use code, it isn't consumed.
    for (const suffix of ["a", "b"]) {
      await page.goto("/register");
      await page.fill("#inviteCode", "GFL-LEAGUE-E2E");
      await page.fill("#displayName", `League Player ${suffix}`);
      await page.fill("#username", `leagueplayer_${suffix}`);
      await page.fill("#password", "leaguepass123");
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/login/);
    }

    await page.fill("#username", "leagueplayer_b");
    await page.fill("#password", "leaguepass123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/picks");
  });

  test("register with already-used invite code shows error", async ({ page }) => {
    await page.goto("/register");
    await page.fill("#inviteCode", "USED-BY-P1");
    await page.fill("#displayName", "Someone");
    await page.fill("#username", "someone2");
    await page.fill("#password", "pass123456");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Invite code already used")).toBeVisible();
  });

  test("register with invalid invite code shows error", async ({ page }) => {
    await page.goto("/register");
    await page.fill("#inviteCode", "NOTACODE");
    await page.fill("#displayName", "Someone");
    await page.fill("#username", "someone3");
    await page.fill("#password", "pass123456");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Invalid invite code")).toBeVisible();
  });
});
