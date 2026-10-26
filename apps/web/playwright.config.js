// Playwright configuration for the web app (marketing + customer + partner workspace).
// Written in JavaScript on purpose: the app's tsconfig includes every *.ts file, so a TS config
// importing `playwright/test` (not an app dependency) would be pulled into `next build` / `tsc`.
// Run:  pnpm --filter @im/web e2e        (needs a production build: `pnpm --filter @im/web build`)
//       E2E_BUILD=1 pnpm --filter @im/web e2e   builds first
//       E2E_BASE_URL=https://… pnpm --filter @im/web e2e   targets an already running server
// The web server is started with PARTNER_MFA_REQUIRED=false so the demo broker/insurer accounts skip TOTP
// (when targeting a running server with E2E_BASE_URL, start it with that variable yourself).
import { defineConfig } from "playwright/test";

// Playwright transpiles these files to CommonJS, so __dirname is available (import.meta is not).
const here = __dirname;
const PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [["list"], ["html", { open: "never", outputFolder: "./e2e/.report" }], ["github"]] : [["list"], ["html", { open: "never", outputFolder: "./e2e/.report" }]],
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: "en-GB",
    timezoneId: "Africa/Accra",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.js$/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: [/auth\.setup\.js$/, /mobile\.spec\.js$/, /signout\.spec\.js$/],
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      testMatch: /mobile\.spec\.js$/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      // Signing out revokes the demo user's sessions, so it must run after every other project.
      name: "signout",
      dependencies: ["chromium", "mobile"],
      testMatch: /signout\.spec\.js$/,
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.E2E_BUILD ? `pnpm exec next build && pnpm exec next start -p ${PORT}` : `pnpm exec next start -p ${PORT}`,
        url: `${baseURL}/robots.txt`,
        cwd: here,
        reuseExistingServer: true,
        timeout: process.env.E2E_BUILD ? 600_000 : 120_000,
        stdout: "ignore",
        stderr: "pipe",
        // Demo partner accounts sign in with a password only; the partner-workspace TOTP gate is off for e2e.
        env: { ...process.env, PARTNER_MFA_REQUIRED: "false" },
      },
});
