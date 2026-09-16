import { defineConfig, devices } from "@playwright/test"
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    ...devices["iPhone 13"],
    defaultBrowserType: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev:demo",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
})
