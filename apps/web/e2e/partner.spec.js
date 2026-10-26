import { test, expect } from "playwright/test";
import { STATE } from "./support/env.js";

test.describe("broker workspace", () => {
  test.use({ storageState: STATE.broker });

  test("overview shows the queue counters", async ({ page }) => {
    await page.goto("/partner");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    for (const label of ["New requests", "Awaiting documents", "Response target at risk"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Workspace" });
    for (const label of ["Request queue", "Quotes", "Customers", "Policies", "Service & claims", "Reports", "Team settings"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByText("Partner workspace").first()).toBeVisible();
  });

  test("request queue renders buckets and filters", async ({ page }) => {
    await page.goto("/partner/requests");
    await expect(page.getByRole("heading", { level: 1, name: "Request queue" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    for (const label of ["All open", "New requests", "Awaiting customer information", "Adviser action", "Insurer response", "Payment confirmation", "Policy documents"]) {
      await expect(tabs.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await tabs.getByRole("link", { name: /^New requests/ }).click();
    await expect(page).toHaveURL(/bucket=new/);
    await expect(tabs.getByRole("link", { name: /^New requests/ })).toHaveAttribute("aria-current", "page");

    const category = page.getByLabel("Category", { exact: true }).last();
    await expect(category).toBeVisible();
    const sort = page.getByLabel("Sort", { exact: true });
    await sort.selectOption("newest");
    await expect(page).toHaveURL(/sort=newest/);
    await expect(page.getByRole("link", { name: "Assigned to me" })).toBeVisible();
    // Either a queue table or the empty state, never a blank page.
    await expect(page.locator("table").or(page.getByText(/No open requests|No requests match these filters/))).toBeVisible();
  });

  test("team settings tabs", async ({ page }) => {
    await page.goto("/partner/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Team settings" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    await expect(page.getByText("Members", { exact: true }).first()).toBeVisible();

    const expectations = [
      ["Organisation", "organisation", "Organisation profile"],
      ["NIC licence", "licence", /licence/i],
      ["Billing", "billing", /plan|subscription|billing/i],
      ["Developer", "developer", /API|webhook/i],
      ["Team", "team", "Members"],
    ];
    for (const [label, key, text] of expectations) {
      await tabs.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`tab=${key}`));
      await expect(tabs.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.locator("main").getByText(text).first()).toBeVisible();
    }
  });
});

test.describe("insurer portal", () => {
  test.use({ storageState: STATE.insurer });

  test("overview is the Level-1 partner portal", async ({ page }) => {
    await page.goto("/partner");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText(/Level 1 partner portal/)).toBeVisible();
    for (const label of ["Submissions awaiting response", "Policies to issue", "Open claims", "Product changes pending"]) await expect(page.getByText(label, { exact: true })).toBeVisible();
  });

  test("submissions inbox with response buckets", async ({ page }) => {
    await page.goto("/partner/submissions");
    await expect(page.getByRole("heading", { level: 1, name: "Submissions" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    for (const label of ["Awaiting response", "Quoted", "Declined", "Quotes expiring"]) await expect(tabs.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    await tabs.getByRole("link", { name: /^Quoted/ }).click();
    await expect(tabs.getByRole("link", { name: /^Quoted/ })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("table").or(page.getByText(/Nothing here|No quotes/))).toBeVisible();
  });

  test("issuance states the payment-never-activates rule", async ({ page }) => {
    await page.goto("/partner/issuance");
    await expect(page.getByRole("heading", { level: 1, name: "Issuance" })).toBeVisible();
    await expect(page.getByText(/Payment confirmation never activates cover/)).toBeVisible();
    await expect(page.getByText(/No policies awaiting issuance/).or(page.getByLabel("Insurer policy number").first())).toBeVisible();
  });

  test("claims desk with assessment buckets", async ({ page }) => {
    await page.goto("/partner/claims");
    await expect(page.getByRole("heading", { level: 1, name: "Claims" })).toBeVisible();
    await expect(page.getByText(/Reporting a claim is not approval/)).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    for (const label of ["New", "In assessment", "Decided", "Paid"]) await expect(tabs.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    await tabs.getByRole("link", { name: /^In assessment/ }).click();
    await expect(page).toHaveURL(/view=/);
    await expect(page.locator("table").or(page.getByText("No claims here"))).toBeVisible();
  });

  test("product data lists versioned products", async ({ page }) => {
    await page.goto("/partner/products");
    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
    await expect(page.locator("table tbody tr").first().or(page.getByText("No products yet"))).toBeVisible();
    await expect(page.getByText("Add a product")).toBeVisible();
    await expect(page.getByLabel("Product code")).toBeVisible();
  });
});
