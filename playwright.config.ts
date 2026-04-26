import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "/tmp/playwright-results.json" }]],
  use: {
    baseURL: "http://localhost:5000",
    // No browser needed for API-only tests — use request context
  },
  projects: [
    {
      name: "api",
      use: {
        // API-only tests: no browser required
      },
    },
  ],
  // Don't spin up a dev server — Flask backend and mock ESPHome must be pre-started
  webServer: undefined,
});
