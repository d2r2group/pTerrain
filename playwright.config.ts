import { defineConfig, devices } from "@playwright/test";

const port = 4173;

// The smoke tests run against `vite preview` of the built site, so `npm run build` comes first.
export default defineConfig({
  testDir: "tests/e2e",
  // Every test loads its own page, so tests within a file run in parallel too.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    // In CI a failed test keeps its trace in test-results/, which the workflow uploads.
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  // Tall enough that the page, which narrows to fit both plots in the window's height, keeps
  // them at their full size, which the tests' pixel distances assume.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 960 } },
    },
  ],
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
