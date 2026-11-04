import { test, expect } from "playwright/test";
import { STATE, TAG } from "./support/env.js";

// Buying directly from an insurer whose line sells directly with instant issuance (server/direct-quotes.ts):
// the quote flow shows an instant price next to the broker picker, and choosing it opens checkout with a binding
// quote and no broker step. Needs an active insurer with a direct, instant Motor line (Unique Insurance on the
// shared project); skipped when none is offered. Stops before payment. The vehicle make carries the E2E tag so the
// purge removes the request (and its quote) afterwards.
const ANSWERS = {
  "Vehicle make": TAG,
  Model: "Corolla",
  "Year of manufacture": "2019",
  "Estimated vehicle value (GH₵)": "150000",
  "Main driver age": "35",
  "Claims in the last 3 years": "0",
};

test("a signed-in customer buys Motor directly from an insurer and lands on checkout", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: STATE.customer, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/quote?category=motor");
  await expect(page.getByText(/Step 2 of 6/)).toBeVisible();

  for (let i = 0; i < 12 && !(await page.getByRole("heading", { level: 1, name: "Check your answers" }).isVisible()); i++) {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const [label, value] of Object.entries(ANSWERS)) {
      const input = page.getByLabel(label, { exact: true });
      if (await input.isVisible()) await input.fill(value);
    }
    const region = page.getByLabel(/region/i);
    if (await region.isVisible()) await region.selectOption("Greater Accra");
    const radios = page.getByRole("radio");
    // Choice screens: the first option is "Comprehensive" for cover and "Private use" for use.
    if ((await radios.count()) > 0) await radios.first().check({ force: true });
    await page.getByRole("button", { name: /Continue/ }).click();
  }
  await page.getByRole("button", { name: /Continue/ }).click();

  const direct = page.getByRole("list", { name: "Direct offers" });
  const brokersOnly = page.getByRole("heading", { level: 1, name: "Choose up to three brokers" });
  await expect(direct.or(brokersOnly)).toBeVisible({ timeout: 20_000 });
  test.skip(await brokersOnly.isVisible(), "No insurer sells Motor directly with instant issuance on this project");

  await expect(page.getByRole("heading", { level: 1, name: "Buy directly or choose a broker" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Or choose up to three brokers" })).toBeVisible();
  const buy = direct.getByRole("button", { name: /^Buy from / }).first();
  await expect(direct.getByText(/GH₵/).first()).toBeVisible();
  await buy.click();

  await page.waitForURL(/\/account\/requests\/[0-9a-f-]{36}\/apply\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  // Direct checkout: "Your insurer" replaces the broker step and the customer starts at the declarations.
  await expect(page.getByRole("list", { name: "Checkout progress" })).toContainText("Your insurer");
  await expect(page.getByText(/Step 2 of 4/)).toBeVisible();
  await expect(page.getByText(/Sold directly by the insurer/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Message your broker/ })).toHaveCount(0);
  await ctx.close();
});
