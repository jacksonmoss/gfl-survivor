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

  test("admin can rename a team", async ({ page }) => {
    await loginAs(page, ADMIN.username, ADMIN.password);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Teams" }).click();

    // distinct stamps so neither name is a substring of the other
    const stamp = Date.now();
    const original = `E2E Orig ${stamp}`;
    const renamed = `E2E New ${stamp}`;

    // the team's roster card has a Rename button; the "Assign Player" card
    // (which also lists the name in a <select>) does not — filter on that.
    const rosterCard = (name: string) =>
      page
        .locator("div.rounded-xl")
        .filter({ has: page.getByRole("button", { name: "Rename" }) })
        .filter({ hasText: name });

    // create a throwaway team to rename
    await page.getByPlaceholder("Team name").fill(original);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(rosterCard(original)).toBeVisible();

    // open the inline editor and rename it
    await rosterCard(original).getByRole("button", { name: "Rename" }).click();
    const editing = page
      .locator("div.rounded-xl")
      .filter({ has: page.getByRole("button", { name: "Save" }) });
    await editing.getByRole("textbox").fill(renamed);
    await editing.getByRole("button", { name: "Save" }).click();

    await expect(rosterCard(renamed)).toBeVisible();
    await expect(rosterCard(original)).toHaveCount(0);
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
