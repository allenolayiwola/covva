// Accessibility smoke for the admin portal (shares the helper with apps/web).
import { test } from "playwright/test";
import { STATE, a11ySmoke } from "./support/env.js";

const PAGES = ["/", "/requests", "/payments", "/policies", "/claims", "/service-partners", "/service-partners?new=1", "/complaints", "/kyc", "/organisations", "/users", "/routing", "/appointments", "/categories", "/products", "/plans", "/subscriptions", "/invoices", "/usage", "/leads", "/ai", "/flags", "/settings", "/audit", "/health"];

test.describe("public", () => {
  test("a11y /sign-in", async ({ page }, testInfo) => a11ySmoke(page, "/sign-in", testInfo));
});

test.describe("staff pages", () => {
  test.use({ storageState: STATE.admin });
  for (const path of PAGES) test(`a11y ${path}`, async ({ page }, testInfo) => a11ySmoke(page, path, testInfo));
});
