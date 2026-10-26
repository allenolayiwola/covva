// Runs last (see playwright.config.js "signout" project): signing out revokes the demo user's sessions.
import { test, expect } from "playwright/test";
import { STATE } from "./support/env.js";

test.describe("sign out", () => {
  test.use({ storageState: STATE.customer });

  test("customer signs out from the profile page and protected pages lock again", async ({ page }) => {
    await page.goto("/account/profile");
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/sign-in\?signed_out=1/);
    await expect(page.getByText("You’ve signed out").or(page.getByText("You've signed out"))).toBeVisible();
    await page.goto("/account");
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  });
});
