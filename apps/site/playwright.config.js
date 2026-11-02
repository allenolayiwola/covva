// Playwright configuration for the marketing site (covva-site).
// Written in JavaScript on purpose: the app's tsconfig includes every *.ts file, so a TS config
// importing `playwright/test` (not an app dependency) would be pulled into `next build` / `tsc`.
// Run:  pnpm --filter @im/site e2e        (needs a production build: `pnpm --filter @im/site build`)
//       E2E_BUILD=1 pnpm --filter @im/site e2e   builds first
//       E2E_BASE_URL=https://… pnpm --filter @im/site e2e   targets an already running server
// No sign-in here: the site has none. Links into the app are stubbed (e2e/support/env.js → stubApp).
import { defineConfig } from "playwright/test";

// Playwright transpiles these files to CommonJS, so __dirname is available (import.meta is not).
const here = __dirname;
const PORT = Number(process.env.E2E_SITE_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const CI = !!process.env.CI;
const APP_ORIGIN = new URL(process.env.E2E_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3102").origin;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: 2,
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
    { name: "chromium", testIgnore: [/mobile\.spec\.js$/], use: { viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.js$/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: process.env.E2E_BUILD ? `pnpm exec next build && pnpm exec next start -p ${PORT}` : `pnpm exec next start -p ${PORT}`,
          url: `${baseURL}/robots.txt`,
          cwd: here,
          reuseExistingServer: true,
          timeout: process.env.E2E_BUILD ? 600_000 : 120_000,
          stdout: "ignore",
          stderr: "pipe",
        },
        {
          // The site forwards app paths to the app with a 307; this stub answers there (e2e/support/app-stub.mjs).
          // A real app already running on that port is reused instead.
          command: "node e2e/support/app-stub.mjs",
          url: APP_ORIGIN,
          cwd: here,
          reuseExistingServer: true,
          timeout: 30_000,
          stdout: "ignore",
          stderr: "pipe",
        },
      ],
});
