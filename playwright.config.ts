import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  // Exercise the exact optimized bundle that ships to production. Vite's development
  // transform server made parallel WebKit runs wait on cold module transforms and hid
  // real chunk-loading behavior behind test-only timing noise.
  webServer: [
    {
      command: "npm run build && npm exec vite preview -- --host 127.0.0.1 --port 4173 --strictPort",
      env: { ...process.env, VITE_DISABLE_PRIVATE_MEDIA_CACHE: "true" },
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    {
      // Build the independent Atlas SPA exactly as the production image does,
      // then serve it at its real sub-path with production-equivalent headers.
      command: process.env.ATLAS_E2E_PREBUILT === "true"
        ? "node e2e/atlas-static-server.mjs"
        : "npm --prefix apps/atlas ci && npm --prefix apps/atlas run build && node e2e/atlas-static-server.mjs",
      url: "http://127.0.0.1:4174/studio/atlas/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
