import { test, expect } from "playwright/test";
import { ADMIN_EMAIL, STATE, TAG } from "./support/env.js";

test.describe("staff sign-in", () => {
  test("anonymous visitors are redirected to the staff sign-in page", async ({ page }) => {
    await page.goto("/organisations");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Forganisations/);
    await expect(page.getByRole("heading", { level: 1, name: "Staff sign in" })).toBeVisible();
    await expect(page.getByText(/multi-factor authentication/)).toBeVisible();
  });

  test("a wrong password shows an inline error", async ({ page }) => {
    await page.goto("/sign-in", { waitUntil: "networkidle" });
    await page.getByLabel("Work email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("admin portal", () => {
  test.use({ storageState: STATE.admin });

  test("overview shows the platform KPIs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    for (const kpi of ["Requests today", "Quote coverage", "Policies issued", "Open complaints", "Request SLA breaches", "Active partners"]) {
      await expect(page.getByText(kpi, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/Audit chain (intact|BROKEN|unavailable)/)).toBeVisible();
    // The provider note sits at the foot of the sidebar (and again in the mobile menu, hidden at this width).
    await expect(page.getByText(/not an insurer or broker and never holds premiums/).first()).toBeVisible();
  });

  test("sidebar groups: the page's group is expanded and only the most specific item is highlighted", async ({ page }) => {
    await page.goto("/claims/fraud");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Admin" }).first();
    await expect(nav.getByRole("link", { name: "Fraud review", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Claims", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("button", { name: "Claims" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Claims");
    await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Fraud review");

    const finance = nav.getByRole("button", { name: "Finance" });
    await expect(finance).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("link", { name: "FX rates", exact: true })).toBeHidden();
    await finance.click();
    await expect(finance).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "FX rates", exact: true })).toBeVisible();
    await finance.click();
    await expect(finance).toHaveAttribute("aria-expanded", "false");

    await page.goto("/service-partners/applications");
    await expect(nav.getByRole("link", { name: "Applications", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Service partners", exact: true })).not.toHaveAttribute("aria-current", "page");
  });

  test("service partners: counts, filter toolbar and drawers open from the URL (nothing is saved)", async ({ page }) => {
    await page.goto("/service-partners");
    await expect(page.getByRole("heading", { level: 1, name: "Service partners" })).toBeVisible();
    const counts = page.getByRole("list", { name: "Partner counts" });
    for (const label of ["Approved", "Awaiting review", "Suspended", "Direct billing", "Garages", "Towing"]) {
      await expect(counts.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("How direct billing works")).toBeVisible();

    await page.getByLabel("Status").selectOption("approved");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/status=approved/);

    // "Add partner" opens the form in a drawer addressed by ?new=1; Esc closes it and keeps the filters.
    await page.getByRole("link", { name: "Add partner", exact: true }).click();
    await expect(page).toHaveURL(/new=1/);
    const add = page.getByRole("dialog", { name: "Add a partner" });
    await expect(add).toBeVisible();
    for (const label of ["Kind", "Name", "Phone", "Email", "Region", "Address", "Latitude", "Longitude", "Services", "Internal notes"]) {
      await expect(add.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(add.getByText("Direct billing with")).toBeVisible();
    await expect(add.getByText("This action is recorded in the audit log.")).toBeVisible();
    await expect(add.getByRole("button", { name: "Add partner" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/new=1/);
    await expect(page).toHaveURL(/status=approved/);
    await expect(page.getByRole("dialog", { name: "Add a partner" })).toHaveCount(0);

    // A refresh keeps the drawer open.
    await page.goto("/service-partners?new=1");
    await expect(page.getByRole("dialog", { name: "Add a partner" })).toBeVisible();
    await page.getByRole("link", { name: "Close" }).click();
    await expect(page).not.toHaveURL(/new=1/);

    // When the directory has partners, a row opens its detail drawer with an Edit tab.
    const row = page.locator("main table tbody a").first();
    if (await row.count()) {
      const name = (await row.textContent())?.trim() ?? "";
      await row.click();
      await expect(page).toHaveURL(/[?&]id=[0-9a-f-]{36}/);
      const detail = page.getByRole("dialog", { name });
      await expect(detail).toBeVisible();
      await detail.getByRole("link", { name: "Edit", exact: true }).click();
      await expect(page).toHaveURL(/tab=edit/);
      await expect(detail.getByRole("button", { name: "Save changes" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page).not.toHaveURL(/[?&]id=/);
    } else {
      await expect(page.getByText("No service partners yet")).toBeVisible();
    }
  });

  test("organisations list and detail tabs", async ({ page }) => {
    await page.goto("/organisations");
    await expect(page.getByRole("heading", { level: 1, name: "Organisations" })).toBeVisible();
    const table = page.locator("main table");
    await expect(table.getByRole("link", { name: "Demo Broker", exact: true })).toBeVisible();
    await expect(table.getByRole("link", { name: /Coastline General/ })).toBeVisible();

    await table.getByRole("link", { name: "Demo Broker", exact: true }).click();
    await page.waitForURL(/\/organisations\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo Broker");
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    for (const label of ["Profile", "Members", "Appointments", "Routing", "Subscription", "Due diligence", "Activity"]) {
      await expect(tabs.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByText("NIC licence verification")).toBeVisible();

    await tabs.getByRole("link", { name: "Members", exact: true }).click();
    await expect(page).toHaveURL(/tab=members/);
    await expect(page.getByRole("heading", { name: "Add member" })).toBeVisible();

    await tabs.getByRole("link", { name: "Routing", exact: true }).click();
    await expect(page).toHaveURL(/tab=routing/);
    await expect(page.getByText("Routing rules")).toBeVisible();

    await tabs.getByRole("link", { name: "Activity", exact: true }).click();
    await expect(page).toHaveURL(/tab=activity/);
    await expect(page.getByText("Last 100 audit events for this organisation.")).toBeVisible();
  });

  test("partner applications queue and appointment requests render", async ({ page }) => {
    await page.goto("/partners/applications");
    await expect(page.getByRole("heading", { level: 1, name: "Partner applications" })).toBeVisible();
    for (const kpi of ["Submitted", "In review", "Needs changes"]) await expect(page.getByText(kpi, { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("Company or licence number")).toBeVisible();
    await expect(page.locator("main table")).toBeVisible();
    await expect(page.locator("main table").getByRole("columnheader", { name: "Completeness" })).toBeVisible();
    // Either queued applications or the empty state, never a blank table.
    await expect(page.locator("main table tbody tr").first()).toBeVisible();
    await page.getByLabel("Status").selectOption("approved");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/status=approved/);

    await page.goto("/partners/appointments");
    await expect(page.getByRole("heading", { level: 1, name: "Appointment requests" })).toBeVisible();
    await expect(page.getByText("Letters awaiting review", { exact: true })).toBeVisible();
    await expect(page.locator("main table tbody tr").first()).toBeVisible();
  });

  test("category launch gate blocks 'integrated' when a checklist item is unticked", async ({ page }) => {
    await page.goto("/categories");
    await expect(page.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible();
    await expect(page.getByText("7/7 recorded").first()).toBeVisible();
    await page.locator("main table").getByRole("link", { name: /Marine cargo/ }).click();
    await page.waitForURL(/\/categories\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Marine cargo");

    const availability = page.getByLabel("Availability");
    await expect(availability).toHaveValue("integrated");
    const claims = page.locator("input[name='lc_claims_procedure']");
    await expect(claims).toBeChecked();
    await claims.uncheck();
    await page.getByRole("button", { name: "Save category" }).click();

    const alert = page.getByRole("alert").filter({ hasText: /Launch gate/ });
    await expect(alert).toContainText("a category can be set to “integrated” only when all 7 launch items are recorded");
    await expect(alert).toContainText("Claims procedure");

    // Nothing was written: reload and the item is still recorded, availability unchanged.
    await page.reload();
    await expect(page.locator("input[name='lc_claims_procedure']")).toBeChecked();
    await expect(page.getByLabel("Availability")).toHaveValue("integrated");
    await expect(page.getByText("All seven launch items are recorded.")).toBeVisible();
  });

  test("settings reject invalid JSON before anything is saved", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByText("brand", { exact: true }).first()).toBeVisible();
    const panel = page.locator("form").filter({ has: page.getByLabel("Key") });
    await panel.getByLabel("Key").fill(`e2e_playwright_${Date.now()}`);
    await panel.getByLabel("Description").fill(`${TAG} must never be saved`);
    await panel.getByLabel("Value (JSON)").fill("this is not json");
    await panel.getByRole("button", { name: "Add setting" }).click();
    await expect(panel.getByRole("alert")).toContainText("Not valid JSON");
    await page.reload();
    await expect(page.getByText(`${TAG} must never be saved`)).toHaveCount(0);
  });

  test("feature flag toggle round-trips and restores the original value", async ({ page }) => {
    await page.goto("/flags");
    await expect(page.getByRole("heading", { level: 1, name: "Feature flags" })).toBeVisible();
    const flag = "ussd_channel"; // harmless narrow-workflow flag, not used by any rendered page
    const toggle = () => page.getByRole("switch", { name: `Toggle ${flag}` });
    const original = await toggle().getAttribute("aria-checked");
    expect(["true", "false"]).toContain(original);
    const flipped = original === "true" ? "false" : "true";
    try {
      await toggle().click();
      await expect(toggle()).toHaveAttribute("aria-checked", flipped);
      await page.reload();
      await expect(toggle()).toHaveAttribute("aria-checked", flipped);
    } finally {
      await page.goto("/flags");
      if ((await toggle().getAttribute("aria-checked")) !== original) {
        await toggle().click();
        await expect(toggle()).toHaveAttribute("aria-checked", original);
      }
    }
    await page.reload();
    await expect(toggle()).toHaveAttribute("aria-checked", original);
  });

  test("audit log verifies the hash chain", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expect(page.getByText(/cannot be edited or deleted/)).toBeVisible();
    await expect(page.locator("main table tbody tr").first()).toBeVisible();
    await page.getByRole("button", { name: "Verify chain" }).click();
    const note = page.getByRole("note").filter({ hasText: /Audit chain/ });
    await expect(note).toContainText("Audit chain intact", { timeout: 60_000 });
    await expect(note).toContainText(/events verified in \d+ ms/);
  });

  test("WhatsApp support inbox, templates and contacts render", async ({ page }) => {
    await page.goto("/whatsapp");
    await expect(page.getByRole("heading", { level: 1, name: "WhatsApp" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Tabs" }).first();
    for (const label of ["Inbox", "Templates", "Contacts"]) await expect(tabs.getByRole("link", { name: label, exact: true })).toBeVisible();
    await expect(page.getByTestId("wa-inbox")).toBeVisible();
    await expect(page.getByText("Recent opt-outs")).toBeVisible();
    await expect(page.getByText(/Select a conversation|Conversation not found/)).toBeVisible();

    await page.goto("/whatsapp/templates");
    await expect(page.getByRole("heading", { level: 1, name: "WhatsApp templates" })).toBeVisible();
    await expect(page.getByTestId("wa-templates").getByText("broker_new_offer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy for Meta submission" }).first()).toBeVisible();

    await page.goto("/whatsapp/contacts");
    await expect(page.getByRole("heading", { level: 1, name: "WhatsApp contacts" })).toBeVisible();
    await expect(page.locator("main table").getByRole("columnheader", { name: "Consent" })).toBeVisible();
  });
});
