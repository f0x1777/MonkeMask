import { defineConfig, devices } from "@playwright/test";

// E2E for the MonkeMask web. The API (FastAPI) and the Next dev server must be
// running on the ports below; `webServer` starts the Next frontend, and the
// global setup script (scripts/run-e2e.sh) starts the API. Screenshots/video are
// captured on each test for visual verification.
// Set E2E_BASE_URL to point at an already-running dev server (e.g. on a non-default
// port when 3000 is taken); doing so also skips the auto-started webServer.
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    screenshot: "on",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
        env: { NEXT_PUBLIC_API_BASE: "http://localhost:8000" },
      },
});
