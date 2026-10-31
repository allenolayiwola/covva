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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Compare real quotes. Pay by MoMo. Keep it all in one place.");
  const card = page.getByRole("form", { name: "What do you want to cover?" });
  await expect(card.getByRole("radio")).toHaveCount(6);
  for (const label of ["Motor", "Home", "Health", "Travel", "Life & funeral", "Business"]) {
    await expect(card.getByText(label, { exact: true })).toBeInViewport();
  }
  await expect(card.getByRole("button", { name: "Continue" })).toBeInViewport();
  await structuralChecks(page);
  await noHorizontalOverflow(page);
  // The desktop primary nav is hidden; a menu control is offered instead.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByRole("button", { name: /menu/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("sign-in on a phone: tabs and form fit", async ({ page }) => {
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Sign-in method" })).toBeVisible();
  // Phone code (+233) is the default; email link is the other tab; password sits behind a secondary link.
  await expect(page.getByLabel("Mobile number")).toBeVisible();
  await expect(page.getByText("+233")).toBeVisible();
  await page.getByRole("tab", { name: "Email link" }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await expect(page.getByLabel("Password")).toBeVisible();
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
