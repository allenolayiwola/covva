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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Protect what matters. Wherever you are.");
  await expect(page.getByRole("link", { name: "Help me choose" }).first()).toBeVisible();
  // Hero on a phone: slide controls and Pause under the header, the copy in the first screen, the picker below it.
  await expect(page.getByRole("button", { name: "Pause slideshow" })).toBeInViewport();
  await expect(page.getByRole("list", { name: "Choose a slide" }).getByRole("button")).toHaveCount(4);
  const subline = page.locator("[data-hero-copy='family'] p").last();
  await expect(subline).toBeInViewport();
  const card = page.getByRole("form", { name: "What would you like to insure?" });
  await expect(card.getByRole("radio")).toHaveCount(6);
  await expect(card.getByRole("button", { name: /Compare quotes/ })).toBeVisible();
  // Once the cookie choice is made, the copy ends above the floating chat/WhatsApp launchers.
  const consent = page.getByRole("region", { name: "Cookie consent" });
  if (await consent.isVisible()) await consent.getByRole("button", { name: "Essential only" }).click();
  await expect(consent).toBeHidden();
  const sub = await subline.boundingBox();
  for (const launcher of await page.locator("[data-chat-launcher], [data-whatsapp]").all()) {
    const box = await launcher.boundingBox();
    if (box) expect(sub.y + sub.height, "hero copy clears the floating launchers").toBeLessThanOrEqual(box.y);
  }
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
