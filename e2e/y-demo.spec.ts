import { test, expect } from "@playwright/test";
import { PLAYER1, loginAs } from "./helpers";

// Demo mode (#161): the one-click week simulation.
//
// Sorts late (hence `y-`) but deliberately *before* `z-admin.spec.ts`: it plays
// week 4 of the seeded 2025 season out and reopens it, which the other specs'
// fixtures don't expect, while z-admin creates and activates a 2026 season with
// no games in it — after which there is no week 4 to simulate. The whole suite
// shares one database, seeded once in global-setup.
//
// Needs DEMO_MODE=true, which playwright.config.ts sets on its webServer. Running
// against a server you started yourself without that flag will fail on the first
// assertion, because the panel deliberately renders nothing when demo mode is off.

test.describe("Demo mode", () => {
  test("simulates week 4 end to end, then reopens it", async ({ page }) => {
    await loginAs(page, PLAYER1.username, PLAYER1.password);

    const panel = page.getByRole("region", { name: /Play out Week 4|Week 4 is played out/ });
    await expect(panel).toBeVisible();

    // Make a pick of our own, so the week has something of ours to grade. This
    // also takes DAL out of player1's hands: from here, the only DAL pick in
    // the league is player2's week-4 one, seeded pre-kickoff.
    await page.getByRole("button", { name: /SF/ }).click();
    await page.waitForResponse("/api/picks");

    // player2's pick is hidden from player1 while its game is still to come —
    // the state the simulation is about to change. Scoped to player2's own row:
    // the simulation hands every other user a random team, so a bare "is there
    // a DAL cell anywhere" check would be answered by whoever drew DAL.
    // The picks are rendered in the row *after* the player's summary row.
    const player2Picks = page.locator('tr:has-text("@player2") + tr');
    await page.goto("/leaderboard");
    await page.getByRole("button", { name: "Show Picks" }).click();
    await expect(page.getByRole("cell", { name: /^SF Pending$/ })).toBeVisible();
    await expect(player2Picks.getByRole("cell", { name: /^DAL/ })).toHaveCount(0);

    await page.goto("/picks");
    await page.getByRole("button", { name: "Simulate week" }).click();
    await page.waitForResponse("/api/demo/simulate");

    // Our pick is graded, not pending.
    await expect(page.getByText(/played out/)).toBeVisible();
    const pickCard = page.locator("div").filter({ hasText: /^Your pick/ }).first();
    await expect(pickCard).toContainText(/WIN|LOSS|Tied/);

    // Every game finished, so nothing is pickable any more.
    await expect(page.getByText(/^Final ·/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /SF/ })).toBeDisabled();

    // And player2's pick is visible now, because its game has kicked off.
    await page.goto("/leaderboard");
    await expect(player2Picks.getByRole("cell", { name: /^DAL (Win|Loss|Tie)$/ })).toBeVisible();

    // Reset puts the week back: no picks, no scores, games open again.
    await page.goto("/picks");
    await page.getByRole("button", { name: "Reset week" }).click();
    await page.waitForResponse("/api/demo/reset");

    await expect(page.getByRole("region", { name: /Play out Week 4/ })).toBeVisible();
    await expect(page.getByText(/^Final ·/)).toHaveCount(0);
    await expect(page.getByText("Your pick", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /SF/ })).not.toBeDisabled();
  });
});
