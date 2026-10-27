// SME & group business workspace (Phase 3). Runs as the demo customer. Re-uses the customer's first business
// account (creating one only when there is none — accounts are capped at 5 per owner) and never deletes rows.
import { test, expect } from "playwright/test";
import { STATE, TAG } from "./support/env.js";

test.describe("business accounts", () => {
  test.use({ storageState: STATE.customer });

  test("create a business account: the form validates before anything is created", async ({ page }) => {
    await page.goto("/account/business/new");
    await expect(page.getByRole("heading", { level: 1, name: "Create a business account" })).toBeVisible();
    await page.getByLabel("Billing email").fill("not-an-email");
    await page.getByRole("button", { name: "Create business account" }).click();
    await expect(page.getByText("Check the highlighted fields.").first()).toBeVisible();
    await expect(page.getByText("Enter the business name").first()).toBeVisible();
    await expect(page.getByText("Enter a valid billing email").first()).toBeVisible();
    await expect(page.getByText("Confirm you can act for this business").first()).toBeVisible();
    await expect(page).toHaveURL(/\/account\/business\/new$/);
  });

  test("members CSV preview lists row-numbered problems and imports nothing", async ({ page }) => {
    await page.goto("/account/business");
    await expect(page.getByRole("heading", { level: 1, name: "Business" })).toBeVisible();
    if (await page.getByText("Insurance for your business").isVisible()) {
      await page.goto("/account/business/new");
      await page.getByLabel("Business name").fill(`${TAG} Business`);
      await page.getByLabel("Industry").fill("Testing");
      await page.getByLabel("Number of employees").fill("10");
      await page.getByLabel("Billing email").fill("e2e-business@example.com");
      await page.getByLabel("Billing contact").fill("E2E Finance");
      await page.getByLabel(/authorised to arrange insurance/).check();
      await page.getByRole("button", { name: "Create business account" }).click();
      await page.waitForURL(/\/account\/business\?org=[0-9a-f-]{36}&created=1$/);
    }
    // Make sure there is a scheme to upload into.
    if (await page.getByText("No schemes yet").isVisible()) {
      await page.getByText("Create a scheme").click();
      await page.getByLabel("Scheme name").fill(`${TAG} staff health`);
      await page.getByRole("button", { name: "Create scheme" }).click();
      await expect(page.getByText(/Scheme GS-\d+ created/)).toBeVisible();
    }
    await page.getByRole("link", { name: "Members" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
    const csv = [
      "employee_ref,full_name,date_of_birth,relationship,principal_ref,phone",
      `${TAG}-1,Ama Test,1990-01-01,employee,,0241234567`,
      `${TAG}-1,Kofi Test,1991-01-01,employee,,0241234568`,
      ",Kid Test,2018-01-01,child,NOPE,",
      ",Bad Date,31/31/1990,employee,,12345",
    ].join("\n");
    await page.getByLabel("Members (CSV)").setInputFiles({ name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByText(/Rows with problems \(3\)/)).toBeVisible();
    await expect(page.getByText(/duplicate employee_ref \(same as row 2\)/)).toBeVisible();
    await expect(page.getByText(/principal_ref "NOPE" does not match an employee/)).toBeVisible();
    await expect(page.getByText(/is not a date/)).toBeVisible();
    await expect(page.getByText(/Ready to import \(1\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Import 1 member/ })).toBeEnabled();
  });
});
