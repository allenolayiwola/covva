// 390×844 viewport run (iPhone-class). Checks layout fits the viewport and the mobile navigation works.
import { test, expect } from "playwright/test";
import { STATE } from "./support/env.js";
import { structuralChecks, watchConsole } from "./support/a11y.js";

async function noHorizontalOverflow(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(innerWidth + 1);
}

test("home on a phone: hero, menu button, no horizontal scroll", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Find cover.");
  await expect(page.getByRole("link", { name: "What do I need?" }).first()).toBeVisible();
  await structuralChecks(page);
  await noHorizontalOverflow(page);
  // The desktop primary nav is hidden; a menu control is offered instead.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByRole("button", { name: /menu/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("sign-in on a phone: tabs and form fit", async ({ page }) => {
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Sign-in method" })).toBeVisible();
  await page.getByRole("tab", { name: "Phone" }).click();
  await expect(page.getByLabel("Mobile number")).toBeVisible();
  await page.getByRole("tab", { name: "Password" }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await structuralChecks(page);
  await noHorizontalOverflow(page);
});

test.describe("signed-in customer", () => {
  test.use({ storageState: STATE.customer });

  test("account dashboard on a phone uses the tab bar", async ({ page }) => {
    await page.goto("/account", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Your cover at a glance" })).toBeVisible();
    const tabBar = page.getByRole("navigation", { name: "Account sections" });
    await expect(tabBar).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Account", exact: true })).toBeHidden();
    await tabBar.getByRole("link", { name: "Claims" }).click();
    await expect(page).toHaveURL(/\/account\/claims/);
    await expect(page.getByRole("heading", { level: 1, name: "Claims" })).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
