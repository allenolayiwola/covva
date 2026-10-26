// Partnerships CRM (Addendum 3 D) — pipeline board, dashboard, tasks and a manual account.
// Signed in as the demo platform admin (MFA off, see auth.setup.js). Rows are tagged E2E-PLAYWRIGHT.
import { test, expect } from "playwright/test";
import { STATE, TAG } from "./support/env.js";

test.describe("partnerships CRM", () => {
  test.use({ storageState: STATE.admin });

  test("pipeline board renders every stage column with filters", async ({ page }) => {
    await page.goto("/partners/crm");
    await expect(page.getByRole("heading", { level: 1, name: "Partnerships CRM" })).toBeVisible();
    const board = page.getByRole("list", { name: "Pipeline by stage" });
    for (const stage of ["Lead", "Contacted", "Meeting", "Proposal", "Agreement signed", "Onboarding", "Live"]) {
      await expect(board.getByRole("listitem", { name: new RegExp(`^${stage} \\(\\d+\\)$`) })).toBeVisible();
    }
    await expect(page.getByText("Open accounts", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Owner" })).toBeVisible();
    await expect(page.getByLabel("Kind", { exact: true })).toBeVisible();
    await expect(page.getByText(/Lost accounts \(\d+\)/)).toBeVisible();
    // Sidebar group
    const nav = page.getByRole("navigation", { name: "Admin" }).first();
    await expect(nav.getByRole("link", { name: "CRM", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("dashboard shows pipeline, time to go-live and revenue panels", async ({ page }) => {
    await page.goto("/partners/crm/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Partnerships dashboard" })).toBeVisible();
    for (const kpi of ["Open accounts", "Pipeline value", "Partners live", "Time to go-live", "Platform revenue"]) {
      await expect(page.getByText(kpi, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Pipeline by stage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Revenue by partner" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Revenue and live partners by rep" })).toBeVisible();
  });

  test("tasks page lists my tasks by due state", async ({ page }) => {
    await page.goto("/partners/crm/tasks");
    await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
    for (const group of ["Overdue", "Due today", "Upcoming"]) {
      await expect(page.getByRole("heading", { name: new RegExp(`^${group}`) })).toBeVisible();
    }
    await page.getByRole("navigation", { name: "Tabs" }).getByRole("link", { name: "Everyone" }).click();
    await expect(page).toHaveURL(/scope=all/);
  });

  test("a rep creates an account manually and lands on its detail page", async ({ page }) => {
    const name = `${TAG} CRM ${Date.now()}`;
    await page.goto("/partners/crm/new");
    await expect(page.getByRole("heading", { level: 1, name: "New account" })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Kind", { exact: true }).selectOption("broker");
    await page.getByLabel("Source", { exact: true }).selectOption("event");
    await page.getByLabel("Region", { exact: true }).fill("Ashanti");
    await page.getByLabel("Contact name", { exact: true }).fill("Kwame Boateng");
    await page.getByLabel("Contact email", { exact: true }).fill("kwame@example.com");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/partners\/crm\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
    await expect(page.getByRole("heading", { name: "Pipeline stage" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Stages" }).getByText("Lead", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Contacted/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Mark lost/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assisted onboarding" })).toBeVisible();

    // Add a note and see it in the timeline.
    await page.getByLabel("Note", { exact: true }).fill(`${TAG} first call booked`);
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText(`${TAG} first call booked`)).toBeVisible();
  });
});
