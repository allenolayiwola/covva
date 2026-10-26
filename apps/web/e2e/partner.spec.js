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

  test("dashboard KPIs and charts render for the demo broker", async ({ page }) => {
    await page.goto("/partner?days=7");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    const panel = page.getByTestId("broker-analytics");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    for (const label of ["Leads received", "Requests", "Quotes sent", "Conversions", "Policies issued", "Renewals due (30 days)", "Lapses (90 days)", "Claims in progress", "Response targets met"]) {
      await expect(panel.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(panel.getByRole("img", { name: "Requests, quotes and conversions per day" })).toBeVisible();
    await expect(panel.getByRole("img", { name: "Policies issued per day" })).toBeVisible();
    const range = panel.getByRole("navigation", { name: "Tabs" });
    await expect(range.getByRole("link", { name: "Last 7 days" })).toHaveAttribute("aria-current", "page");
    await range.getByRole("link", { name: "Last 30 days" }).click();
    await expect(page).toHaveURL(/days=30/);
  });

  test("reports export returns CSV for the analytics datasets", async ({ page }) => {
    await page.goto("/partner/reports");
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    await expect(page.getByTestId("broker-analytics")).toBeVisible({ timeout: 30_000 });
    for (const type of ["sales", "renewals", "claims"]) {
      const res = await page.request.get(`/partner/reports/export?type=${type}&days=30`);
      expect(res.status(), `${type} export`).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/csv");
      const body = await res.text();
      expect(body.split("\n")[0]).toContain(type === "sales" ? "day,requests,quotes" : type === "renewals" ? "policy_reference" : "reference,status");
    }
    const sales = await (await page.request.get("/partner/reports/export?type=sales&days=7")).text();
    expect(sales.trim().split("\n")).toHaveLength(8); // header + 7 days
    const bad = await page.request.get("/partner/reports/export?type=nope");
    expect(bad.status()).toBe(400);
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

  test("insurer dashboard shows sales, renewals, lapses, claims, SLA and settlements", async ({ page }) => {
    await page.goto("/partner?days=30");
    const panel = page.getByTestId("insurer-analytics");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    for (const label of ["Sales (premium)", "Submissions received", "Quotes", "Conversions", "Policies issued", "Renewals due (30 days)", "Lapses (90 days)", "Claims in progress", "SLA performance"]) {
      await expect(panel.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(panel.getByRole("img", { name: "Submissions, quotes and conversions per day" })).toBeVisible();
    await expect(panel.getByRole("meter", { name: "Submissions answered within target" })).toBeVisible();
    await expect(panel.getByText("Renewals due", { exact: true })).toBeVisible();
    // Insurer users never see customer contact details on the renewals panel.
    await expect(panel.getByText(/@/)).toHaveCount(0);
    const res = await page.request.get("/partner/reports/export?type=renewals&days=30");
    expect(res.status()).toBe(200);
    expect((await res.text()).split("\n")[0]).not.toContain("email");
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
