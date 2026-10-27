import { test, expect } from "playwright/test";
import { ACCOUNTS, PASSWORD, STATE, TAG } from "./support/env.js";

test.describe("customer sign-in", () => {
  test("wrong password shows a friendly error and keeps you on the sign-in page", async ({ page }) => {
    await page.goto("/sign-in", { waitUntil: "networkidle" }); // settle hydration before typing
    await page.getByLabel("Email address").fill(ACCOUNTS.customer);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That email and password don't match")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("protected pages redirect anonymous visitors to sign-in with a next param", async ({ page }) => {
    await page.goto("/account/policies");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fpolicies/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  });

  test("signing in with the password lands on the dashboard", async ({ page }) => {
    await page.goto("/sign-in", { waitUntil: "networkidle" });
    await page.getByLabel("Email address").fill(ACCOUNTS.customer);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/account/);
    await expect(page.getByRole("heading", { level: 1, name: "Your cover at a glance" })).toBeVisible();
  });
});

test.describe("customer account", () => {
  test.use({ storageState: STATE.customer });

  test("dashboard shows the overview with account navigation", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByRole("heading", { level: 1, name: "Your cover at a glance" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Account" });
    for (const label of ["Overview", "My policies", "Requests", "Claims", "Profile"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "My account" })).toBeVisible();
  });

  test("new request: missing required fields are flagged before anything is sent", async ({ page }) => {
    await page.goto("/account/requests/new");
    await expect(page.getByRole("heading", { level: 1, name: "Get a quote" })).toBeVisible();
    await page.getByRole("button", { name: /^Motor/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: /Motor · Tell us what you need/ })).toBeVisible();

    // Motor starts with three fields (registration, use, value) and a "Find my vehicle" lookup; the rest sits under "Check details".
    await expect(page.getByRole("heading", { level: 3, name: "Start with three details" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Find my vehicle" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Check details/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel(/Talk to an expert first/)).not.toBeChecked();

    await page.getByRole("button", { name: "Send request" }).click();
    // Client-side zod validation (riskSchemaToZod) blocks the submit and focuses the first error.
    await expect(page.getByText("Choose type of cover").first()).toBeVisible();
    await expect(page.getByText("Year of manufacture must be a number").first()).toBeVisible();
    await expect(page.getByLabel("Type of cover")).toBeFocused();
    await expect(page).toHaveURL(/\/account\/requests\/new$/);
  });

  test("new request: the registration lookup degrades gracefully and never blocks the form", async ({ page }) => {
    await page.goto("/account/requests/new?category=motor");
    await expect(page.getByRole("heading", { level: 2, name: /Motor · Tell us what you need/ })).toBeVisible();
    // Empty registration: a field error, no network call.
    await page.getByRole("button", { name: "Find my vehicle" }).click();
    await expect(page.getByText("Enter the registration number, e.g. GR 1234-23")).toBeVisible();
    await expect(page.getByLabel("Registration number (optional)")).toBeFocused();
    // Unknown plate: "couldn't find" (or "isn't available") and the detail fields stay open for manual entry.
    await page.getByLabel("Registration number (optional)").fill("E2E 0000-00");
    await page.getByRole("button", { name: "Find my vehicle" }).click();
    await expect(page.getByText(/couldn.t find that registration|Lookup isn.t available/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Vehicle make")).toBeVisible();
    await expect(page.getByLabel("Registration number (optional)")).toHaveValue("E2E 0000-00");
  });

  test("new request: a complete motor form is sent (or reports that the service is unavailable)", async ({ page }, testInfo) => {
    await page.goto("/account/requests/new?category=motor");
    await expect(page.getByRole("heading", { level: 2, name: /Motor · Tell us what you need/ })).toBeVisible();

    await page.getByLabel("Type of cover").selectOption("comprehensive");
    await page.getByLabel("Vehicle make").fill(TAG); // becomes the request title → purge-able
    await page.getByLabel("Model", { exact: true }).fill("Corolla");
    await page.getByLabel("Year of manufacture").fill("2020");
    await page.getByLabel("Estimated vehicle value (GH₵)").fill("80000");
    await page.getByLabel("Registration number (optional)").fill("GR 0000-00");
    await page.getByLabel("How is the vehicle used?").selectOption("private");
    await page.getByLabel("Main driver age").fill("35");
    await page.getByLabel("Claims in the last 3 years").fill("0");
    await page.getByLabel("Region").selectOption("Greater Accra");
    await page.getByLabel(/Anything else your broker should know/).fill(`${TAG}: automated browser test. Safe to delete.`);
    await expect(page.getByText("Draft saved on this device")).toBeVisible();

    await page.getByRole("button", { name: "Send request" }).click();

    const unavailable = page.getByText("We couldn't send your request just now");
    const created = page.waitForURL(/\/account\/requests\/[0-9a-f-]{36}\?new=1/, { timeout: 45_000 }).then(() => "created", () => "pending");
    const outcome = await Promise.race([unavailable.waitFor({ timeout: 45_000 }).then(() => "unavailable", () => "pending"), created]);

    if (outcome === "unavailable") {
      // No SUPABASE_SECRET_KEY on the server: createRequest() cannot assign a broker. The form keeps the draft.
      testInfo.annotations.push({ type: "conditional", description: "request creation unavailable (server has no SUPABASE_SECRET_KEY); asserted the friendly error instead" });
      await expect(unavailable).toContainText("Your answers are saved on this device");
      await expect(page).toHaveURL(/\/account\/requests\/new/);
    } else {
      expect(outcome).toBe("created");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(TAG);
      await expect(page.getByText(/REQ-\d+/)).toBeVisible();
    }
  });

  test("policies wallet lists cover or an empty state", async ({ page }) => {
    await page.goto("/account/policies");
    await expect(page.getByRole("heading", { level: 1, name: "My policies" })).toBeVisible();
    const cards = page.locator("a[href^='/account/policies/']:not([href$='/new'])");
    const empty = page.getByText("Your wallet is empty");
    await expect(cards.first().or(empty)).toBeVisible();
    if ((await cards.count()) > 0) {
      await cards.first().click();
      await page.waitForURL(/\/account\/policies\/[0-9a-f-]{36}/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Every policy names its parties (insurer, broker of record or "issued directly", issuance, complaints contacts).
      await expect(page.getByRole("heading", { level: 2, name: "Who's who on this policy" })).toBeVisible();
      await expect(page.getByText(/Technology provided by|We provide the technology/).first()).toBeVisible();
    }
  });

  test("claims list renders with the insurer-decides disclaimer", async ({ page }) => {
    await page.goto("/account/claims");
    await expect(page.getByRole("heading", { level: 1, name: "Claims" })).toBeVisible();
    const rows = page.locator("a[href^='/account/claims/']:not([href$='/new'])");
    const empty = page.getByText("No claims");
    await expect(rows.first().or(empty)).toBeVisible();
    await expect(page.getByText(/insurer (assesses|decides)/i).first()).toBeVisible();
    // Claim detail: the journey with expected times, the thread and the files list (Phase 2 claims completion).
    if (await rows.first().isVisible().catch(() => false)) {
      await rows.first().click();
      await page.waitForURL(/\/account\/claims\/[0-9a-f-]{36}/);
      await expect(page.getByRole("heading", { level: 2, name: "Timeline" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Messages" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: /Files you/ })).toBeVisible();
    }
  });

  test("profile: change the preferred name and revert it", async ({ page }) => {
    await page.goto("/account/profile");
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    const field = page.getByLabel(/What should we call you/);
    const original = await field.inputValue();
    const form = page.locator("form").filter({ has: field });
    const saved = form.getByText("Your details have been saved.");
    try {
      await field.fill(`${TAG} Ama`);
      await form.getByRole("button", { name: "Save details" }).click();
      await expect(saved).toBeVisible();
      await page.reload();
      await expect(page.getByLabel(/What should we call you/)).toHaveValue(`${TAG} Ama`);
    } finally {
      await page.goto("/account/profile");
      const again = page.getByLabel(/What should we call you/);
      await again.fill(original);
      await page.locator("form").filter({ has: again }).getByRole("button", { name: "Save details" }).click();
      await expect(page.getByText("Your details have been saved.")).toBeVisible();
    }
    await page.reload();
    await expect(page.getByLabel(/What should we call you/)).toHaveValue(original);
  });
});

test.describe("customer referrals", () => {
  test.use({ storageState: STATE.customer });

  test("/account/referrals renders the link card, friends and honest credit copy", async ({ page }) => {
    await page.goto("/account/referrals");
    await expect(page.getByRole("heading", { level: 1, name: "Refer a friend" })).toBeVisible();
    await expect(page.getByTestId("referrals-page")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Your link" })).toBeVisible();
    await expect(page.getByText(/Credits are not cash/)).toBeVisible();
  });
});
