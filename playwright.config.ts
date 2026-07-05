import { defineConfig, devices } from "@playwright/test";

const E2E_DB_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://gfl:gfl_dev_password@localhost:5433/gfl_e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/mobile.spec.ts",
    },
    {
      name: "mobile",
      // Use Chromium with iPhone 14 viewport — avoids requiring a separate WebKit install.
      use: {
        browserName: "chromium",
        viewport: devices["iPhone 14"].viewport,
        userAgent: devices["iPhone 14"].userAgent,
        deviceScaleFactor: devices["iPhone 14"].deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
      },
      testMatch: "**/mobile.spec.ts",
    },
  ],
  webServer: {
    command: "PORT=3001 pnpm start",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      DATABASE_URL: E2E_DB_URL,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "e2e-test-secret-32chars-minimum!",
      NEXTAUTH_URL: "http://localhost:3001",
      // The suite logs in on every test from one IP; disable auth rate limiting
      // so it doesn't trip the login limit (see src/proxy.ts, issue #5).
      RATE_LIMIT_DISABLED: "true",
    },
  },
});
