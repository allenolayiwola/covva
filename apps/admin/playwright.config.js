// Playwright configuration for the admin portal. JavaScript for the same reason as apps/web:
// the app tsconfig includes every *.ts file and `playwright/test` is not an app dependency.
// Run:  pnpm --filter @im/admin e2e      (needs a production build; E2E_BUILD=1 builds first)
// The admin server is started with ADMIN_MFA_REQUIRED=false so the demo admin can skip TOTP.
import { defineConfig } from "playwright/test";

// Playwright transpiles these files to CommonJS, so __dirname is available (import.meta is not).
const here = __dirname;
const PORT = Number(process.env.E2E_ADMIN_PORT ?? 3101);
const baseURL = process.env.E2E_ADMIN_BASE_URL ?? `http://localhost:${PORT}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: 1, // admin tests mutate shared platform state (flags); keep them serial
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
    viewport: { width: 1366, height: 850 },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.js$/ },
    { name: "chromium", dependencies: ["setup"], testIgnore: [/auth\.setup\.js$/] },
  ],
  webServer: process.env.E2E_ADMIN_BASE_URL
    ? undefined
    : {
        command: process.env.E2E_BUILD ? `pnpm exec next build && pnpm exec next start -p ${PORT}` : `pnpm exec next start -p ${PORT}`,
        url: `${baseURL}/sign-in`,
        cwd: here,
        reuseExistingServer: true,
        timeout: process.env.E2E_BUILD ? 600_000 : 120_000,
        stdout: "ignore",
        stderr: "pipe",
        env: { ...process.env, ADMIN_MFA_REQUIRED: "false" },
      },
});
