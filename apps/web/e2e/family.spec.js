// Diaspora: family dashboard, add a beneficiary, consent UI. Runs as the demo customer.
import { test, expect } from "playwright/test";
import { STATE, TAG } from "./support/env.js";

test.describe("family (diaspora)", () => {
  test.use({ storageState: STATE.customer });

  test("the family page renders with the add-member action and sits in the account navigation", async ({ page }) => {
    await page.goto("/account/family");
    await expect(page.getByRole("heading", { level: 1, name: "Family" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a family member" }).first()).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Account" });
    await expect(nav.getByRole("link", { name: "Family" })).toHaveAttribute("aria-current", "page");
  });

  test("add a family member: validation blocks a non-Ghana number and a missing relationship", async ({ page }) => {
    await page.goto("/account/family/beneficiaries/new");
    await expect(page.getByRole("heading", { level: 1, name: "Add a family member" })).toBeVisible();
    await page.getByLabel("Full name").fill(`${TAG} Akua`);
    await page.getByLabel(/Their mobile number/).fill("+44 7700 900123");
    await page.getByRole("button", { name: "Add and send consent code" }).click();
    // Server-side zod (beneficiarySchema) maps issues back to the fields; nothing is created.
    await expect(page.getByText("Choose how they are related to you").first()).toBeVisible();
    await expect(page.getByText("Enter a Ghana mobile number, e.g. 024 123 4567").first()).toBeVisible();
    await expect(page).toHaveURL(/\/account\/family\/beneficiaries\/new$/);
  });

  test("the consent UI appears on a beneficiary page after adding a member", async ({ page }) => {
    const phone = `055${String(Date.now()).slice(-7)}`;
    await page.goto("/account/family/beneficiaries/new");
    await page.getByLabel("Full name").fill(`${TAG} Kofi Mensah`);
    await page.getByLabel("Relationship to you").selectOption("sibling");
    await page.getByLabel(/Their mobile number/).fill(phone);
    await page.getByLabel(/Notes for your broker/).fill(TAG);
    await page.getByRole("button", { name: "Add and send consent code" }).click();
    await page.waitForURL(/\/account\/family\/beneficiaries\/[0-9a-f-]{36}\?added=1$/);
    await expect(page.getByRole("heading", { level: 1, name: `${TAG} Kofi Mensah` })).toBeVisible();
    await expect(page.getByText("Awaiting consent").first()).toBeVisible();
    // Consent panel: channel choice + send button for data sharing; proxy claims waits for data consent.
    const panel = page.getByLabel("Share my details so cover can be arranged for me");
    await expect(panel.getByRole("button", { name: /Send consent code to / })).toBeVisible();
    await expect(panel.getByRole("radio", { name: "SMS" })).toBeChecked();
    await expect(page.getByLabel("Let my sponsor start and follow claims for me").getByText(/Available once/)).toBeVisible();
    // The request form offers this member under "Who is this cover for?" (disabled until consent).
    await page.goto("/account/requests/new?category=motor");
    await page.locator("label", { hasText: "A family member in Ghana" }).click();
    await expect(page.getByRole("radio", { name: "A family member in Ghana" })).toBeChecked();
    const option = page.getByLabel("Family member").locator("option", { hasText: `${TAG} Kofi Mensah` }).first();
    await expect(option).toHaveAttribute("disabled", "");
  });
});
