import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);

/**
 * End-to-end tests against a real stack: Docker infrastructure (Postgres,
 * Redis, MinIO) must be up and migrated. Playwright starts the edge, the
 * worker and the web app, or reuses ones already running locally (`bun run dev`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The dev server compiles routes on demand; too many workers starve it.
  workers: ci ? 2 : 3,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  // The dev server compiles on first use and is slower under parallel workers.
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bun scripts/with-env.ts go run ./services/edge",
      cwd: "../..",
      url: "http://localhost:8080/healthz",
      reuseExistingServer: !ci,
      timeout: 180_000,
    },
    {
      command: "bun scripts/with-env.ts go run ./services/worker",
      cwd: "../..",
      url: "http://localhost:8081/healthz",
      reuseExistingServer: !ci,
      timeout: 180_000,
    },
    {
      // CI runs the production build (`bun run build` first); locally the dev server.
      command: `bun ../../scripts/with-env.ts next ${ci ? "start" : "dev"} --port 3000`,
      url: "http://localhost:3000/api/healthz",
      reuseExistingServer: !ci,
      timeout: 180_000,
    },
  ],
});
