import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/integration",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  globalSetup: "./tests/integration/global-setup.js",
  globalTeardown: "./tests/integration/global-teardown.js",
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
  },
  // These engines cover Firefox directly and the engines used by Chrome/Edge and
  // Safari. The compatibility result and its limits are recorded in nginx.md.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
