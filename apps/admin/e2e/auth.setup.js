import { mkdirSync } from "node:fs";
import { test as setup, expect } from "playwright/test";
import { AUTH_DIR, STATE, signInAsAdmin } from "./support/env.js";

setup("platform admin signs in (MFA disabled for demo)", async ({ page }) => {
  mkdirSync(AUTH_DIR, { recursive: true });
  await signInAsAdmin(page);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  // The shell warns loudly that MFA is off — that is the expected demo configuration.
  await expect(page.getByRole("alert").filter({ hasText: "MFA disabled" })).toBeVisible();
  await page.context().storageState({ path: STATE.admin });
});
