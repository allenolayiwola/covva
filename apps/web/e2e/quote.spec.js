import { test, expect } from "playwright/test";
import { STATE } from "./support/env.js";

// Quote flow, shared quotes and the embedded widget: the public pages served by the app (covva-app).
// Marketing pages and their tests live in apps/site/e2e.
test.describe("quote flow", () => {
  test("the quote flow (as reached from the site's home card) asks one question per screen", async ({ page }) => {
    await page.goto("/quote?type=health");
    // Step 2 of 6: the first question for health cover, with a progress bar and the sticky bar.
    await expect(page.getByText(/Step 2 of 6/)).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Quote progress" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
    // Required answers are enforced before moving on.
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    // Fill the health questions: members + age, plan level (cards), pre-existing (yes/no), region.
    await page.getByLabel("People to cover").fill("3");
    await page.getByLabel("Age of oldest member").fill("45");
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("radio").first().check({ force: true });
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("radio", { name: "No" }).check({ force: true });
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByLabel(/region/i).selectOption("Greater Accra");
    await page.getByRole("button", { name: /Continue/ }).click();
    // Review, then the sign-in gate (anonymous): brokers are chosen only after sign-in.
    await expect(page.getByRole("heading", { level: 1, name: "Check your answers" })).toBeVisible();
    await expect(page.getByText("A quote request is not cover.").first()).toBeVisible();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to choose your brokers" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Continue with phone/ })).toHaveAttribute("href", /\/sign-in\?method=phone&next=%2Fquote%3Fresume%3D1/);
  });

  test("quote flow Back works on a deep link with no earlier step history", async ({ page }) => {
    await page.goto("/quote?category=motor");
    await expect(page.getByText(/Step 2 of 6/)).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/quote/);
    await expect(page.getByRole("heading", { level: 1, name: "What do you want to insure?" })).toBeVisible();
  });

  test("signed-in customer reaches the broker picker and the button counts brokers", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: STATE.customer, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto("/quote?category=travel");
    for (let i = 0; i < 8 && !(await page.getByRole("heading", { level: 1, name: "Check your answers" }).isVisible()); i++) {
      const radios = page.getByRole("radio");
      if ((await radios.count()) > 0) await radios.first().check({ force: true });
      for (const input of await page.locator("input[type='number']:visible").all()) await input.fill("2");
      for (const input of await page.locator("input[type='date']:visible").all()) await input.fill("2027-03-01");
      await page.getByRole("button", { name: /Continue/ }).click();
    }
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Choose up to three brokers" })).toBeVisible();
    const send = page.getByRole("button", { name: /Send to/ });
    await expect(send).toBeDisabled();
    const brokers = page.getByRole("checkbox", { name: /./ });
    await brokers.nth(0).check({ force: true });
    await expect(send).toHaveText(/Send to 1 broker\b/);
    if ((await brokers.count()) > 1) {
      await brokers.nth(1).check({ force: true });
      await expect(send).toHaveText(/Send to 2 brokers/);
    }
    await ctx.close();
  });

  test("shared quotes: a bad token renders the not-found page (noindex) and never leaks data", async ({ page }) => {
    await page.goto("/q/not-a-real-token");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/couldn.t find that page/i);
    await expect(page.locator("meta[name='robots']").first()).toHaveAttribute("content", /noindex/);
    // A well-formed but unknown token behaves the same.
    await page.goto(`/q/${"a".repeat(48)}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/couldn.t find that page/i);
  });

});

test.describe("embedded quote widget", () => {
  test("an unknown partner code renders a friendly not-available state (and is never framable by others)", async ({ page }) => {
    const res = await page.goto("/embed/quote?partner=bad");
    expect(res?.status()).toBe(200);
    expect(res?.headers()["x-frame-options"]).toBeUndefined();
    expect(res?.headers()["content-security-policy"] ?? "").toContain("frame-ancestors 'self'");
    await expect(page.getByTestId("embed-unavailable")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /aren.t available here right now/ })).toBeVisible();
    await expect(page.getByText("Technology provided by Covva. Insurance provided by licensed insurers and brokers.")).toBeVisible();
  });
});
