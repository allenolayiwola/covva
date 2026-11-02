// 390×844 viewport run (iPhone-class). Checks layout fits the viewport and the mobile navigation works.
import { test, expect } from "playwright/test";
import { structuralChecks, watchConsole } from "./support/a11y.js";

async function noHorizontalOverflow(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(innerWidth + 1);
}

test("home on a phone: hero, menu button, no horizontal scroll", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Insurance you actually understand.");
  const card = page.getByRole("form", { name: "What would you like to cover?" });
  await expect(card.getByRole("radio")).toHaveCount(6);
  for (const label of ["Motor", "Travel", "Health", "Home", "Business", "Life"]) {
    await expect(card.getByText(label, { exact: true })).toBeInViewport();
  }
  await expect(card.getByRole("button", { name: "Start my motor quote" })).toBeInViewport();
  await structuralChecks(page);
  await noHorizontalOverflow(page);
  // The desktop primary nav is hidden; a menu control is offered instead.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByRole("button", { name: /menu/i })).toBeVisible();
  expect(errors).toEqual([]);
});
