import { type Page } from "@playwright/test";

export const ADMIN = { username: "admin", password: "admin123" };
export const PLAYER1 = { username: "player1", password: "player123" };

export async function loginAs(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/picks");
}
