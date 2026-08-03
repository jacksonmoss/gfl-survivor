import { test, expect, type Page } from "@playwright/test";
import { PLAYER1, loginAs } from "./helpers";

// The form renders before its GET resolves and then overwrites the inputs with
// the stored values, so filling right after navigation would be racy — wait for
// the fetch to land first.
async function openSettings(page: Page) {
  const loaded = page.waitForResponse(
    (r) => r.url().includes("/api/settings") && r.request().method() === "GET"
  );
  await page.goto("/settings");
  await loaded;
}

// #126 — Settings edits first/last name (matching signup) rather than a raw
// "Real Name" field. Each test restores player1's seeded profile at the end so
// later specs (leaderboard, z-admin) still see "Player One".
test.describe("Settings profile", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);
    await openSettings(page);
  });

  async function restoreSeededProfile(page: Page) {
    await openSettings(page);
    await page.getByLabel("First Name").fill("");
    await page.getByLabel("Last Name").fill("");
    await page.getByLabel("Display Name").fill("Player One");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
  }

  test("first/last name round-trip and drive the leaderboard's full name", async ({ page }) => {
    // Seeded player1 has a display name but no real name.
    await expect(page.getByLabel("Display Name")).toHaveValue("Player One");
    await expect(page.getByLabel("First Name")).toHaveValue("");
    await expect(page.getByLabel("Last Name")).toHaveValue("");

    // A multi-word last name exercises the split-on-first-space round trip.
    await page.getByLabel("First Name").fill("Peter");
    await page.getByLabel("Last Name").fill("Van Onen");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("First Name")).toHaveValue("Peter");
    await expect(page.getByLabel("Last Name")).toHaveValue("Van Onen");
    // An explicit display name survives a name edit — it isn't re-derived.
    await expect(page.getByLabel("Display Name")).toHaveValue("Player One");

    // The leaderboard prefers the full name once it's set.
    await page.goto("/leaderboard");
    await expect(page.locator("td").filter({ hasText: "Peter Van Onen" })).toBeVisible();

    await restoreSeededProfile(page);
    await page.goto("/leaderboard");
    await expect(page.locator("td").filter({ hasText: "Player One" })).toBeVisible();
  });

  test("clearing the display name falls back to the first name, then the username", async ({
    page,
  }) => {
    await page.getByLabel("First Name").fill("Petra");
    await page.getByLabel("Display Name").fill("");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Display Name")).toHaveValue("Petra");

    // With no first name either, it falls back to the username.
    await page.getByLabel("First Name").fill("");
    await page.getByLabel("Display Name").fill("");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Display Name")).toHaveValue(PLAYER1.username);

    await restoreSeededProfile(page);
  });
});
