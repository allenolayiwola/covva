// Partner self-service registration (Addendum 3 B1/C1): sign-in gate, step 1 draft, status page.
import { test, expect } from "playwright/test";
import { STATE, TAG } from "./support/env.js";

test.describe("partner registration (signed out)", () => {
  test("redirects to sign-in and keeps the destination", async ({ page }) => {
    await page.goto("/partner/register?type=broker");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fpartner%2Fregister%3Ftype%3Dbroker/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  });

  test("the type chooser is also behind sign-in", async ({ page }) => {
    await page.goto("/partner/register");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fpartner%2Fregister/);
  });
});

test.describe("partner registration (signed-in customer)", () => {
  test.use({ storageState: STATE.customer });

  test("shows step 1 for a broker and saves a draft", async ({ page }) => {
    await page.goto("/partner/register?type=broker&step=company");
    await expect(page.getByRole("heading", { level: 1, name: "Register as a Broker" })).toBeVisible();
    const steps = page.getByRole("navigation", { name: "Registration steps" });
    for (const label of ["Company", "NIC licence", "Contacts", "Settlement account", "Documents", "Commercial model", "Partner agreement", "Review & submit"]) {
      await expect(steps.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(steps.getByText("Integration levels")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Company details" })).toBeVisible();

    await page.getByLabel("Trading name").fill(`${TAG} Brokers Ltd`);
    await page.getByLabel("Registered address").fill("12 Independence Avenue, Accra");
    await page.getByLabel("Region").selectOption("Greater Accra");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Draft saved: the flow moves to the licence step and the company step is marked done.
    await expect(page).toHaveURL(/\/partner\/register\?type=broker&step=/);
    await expect(page.getByRole("heading", { level: 2, name: /NIC licence|Contacts|Settlement|Documents|Commercial|agreement|Review/ })).toBeVisible();
    await page.goto("/partner/register?type=broker&step=company");
    await expect(page.getByLabel("Trading name")).toHaveValue(`${TAG} Brokers Ltd`);
    await expect(page.getByRole("link", { name: "Application status" })).toBeVisible();
  });

  test("insurer flow has integration levels instead of a commercial model", async ({ page }) => {
    await page.goto("/partner/register?type=insurer");
    await expect(page.getByRole("heading", { level: 1, name: "Register as an Insurer" })).toBeVisible();
    const steps = page.getByRole("navigation", { name: "Registration steps" });
    await expect(steps.getByText("Integration levels", { exact: true })).toBeVisible();
    await expect(steps.getByText("Commercial model")).toHaveCount(0);
  });

  test("the status page renders", async ({ page }) => {
    await page.goto("/partner/register/status");
    await expect(page.getByRole("heading", { level: 1, name: "Your partner application" })).toBeVisible();
    // Either the draft saved above (with its timeline) or the empty state — never a blank page.
    await expect(page.getByText("Application started").first().or(page.getByText("No application yet"))).toBeVisible();
  });
});
