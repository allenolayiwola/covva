import { test, expect } from "playwright/test";
import { STATE } from "./support/env.js";

// Addendum 4: partner security — session/device page and the MFA gate.
// The e2e server runs with PARTNER_MFA_REQUIRED=false, so /partner/mfa must simply forward to `next`.
test.describe("partner security", () => {
  test.use({ storageState: STATE.broker });

  test("security page lists sessions and devices for the demo broker", async ({ page }) => {
    await page.goto("/partner/settings/security");
    await expect(page.getByRole("heading", { level: 1, name: "Security" })).toBeVisible();
    const main = page.locator("main");
    await expect(main.getByText("Two-step verification", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Where you're signed in", { exact: true })).toBeVisible();
    // The current browser session is always listed and flagged.
    await expect(main.getByText("This device", { exact: true }).first()).toBeVisible();
    await expect(main.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();
    await expect(main.getByText("Mobile devices", { exact: true })).toBeVisible();
    // Security is reachable from the settings tabs.
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    await expect(tabs.getByRole("link", { name: "Security", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("team settings offers the Addendum 3 role labels", async ({ page }) => {
    await page.goto("/partner/settings?tab=team");
    // The invite form's role picker (member rows also have one, inside collapsed <details>).
    const role = page.locator("#iv-role");
    await expect(role).toBeVisible();
    const labels = await role.locator("option").allTextContents();
    expect(labels).toEqual(expect.arrayContaining(["Admin", "Account Executive", "Claims", "Finance", "Read-only"]));
    expect(labels).not.toContain("Adviser");
  });

  test("/partner/mfa forwards to the workspace when MFA is not required", async ({ page }) => {
    await page.goto("/partner/mfa?next=%2Fpartner%2Frequests");
    await expect(page).toHaveURL(/\/partner\/requests/);
    await expect(page.getByRole("heading", { level: 1, name: "Request queue" })).toBeVisible();
  });

  test("/partner/mfa with no next lands on the overview", async ({ page }) => {
    await page.goto("/partner/mfa");
    await expect(page).toHaveURL(/\/partner$/);
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });
});
