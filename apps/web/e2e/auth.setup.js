// Creates role-based storageState files by signing in through the real sign-in page.
import { mkdirSync } from "node:fs";
import { test as setup, expect } from "playwright/test";
import { ACCOUNTS, AUTH_DIR, STATE, signInViaForm } from "./support/env.js";

setup.beforeAll(() => mkdirSync(AUTH_DIR, { recursive: true }));

setup("customer signs in", async ({ page }) => {
  await signInViaForm(page, { email: ACCOUNTS.customer, next: "/account" });
  await expect(page.getByRole("heading", { level: 1, name: "Your cover at a glance" })).toBeVisible();
  await page.context().storageState({ path: STATE.customer });
});

setup("broker supervisor signs in", async ({ page }) => {
  await signInViaForm(page, { email: ACCOUNTS.broker, next: "/partner" });
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await page.context().storageState({ path: STATE.broker });
});

setup("insurer underwriter signs in", async ({ page }) => {
  await signInViaForm(page, { email: ACCOUNTS.insurer, next: "/partner" });
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await page.context().storageState({ path: STATE.insurer });
});
