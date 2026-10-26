// Admin e2e settings. Re-exports the shared a11y helpers from the web suite to keep one implementation.
import { join } from "node:path";

// Playwright transpiles these files to CommonJS, so __dirname is available (import.meta is not).
const here = __dirname;

export const PASSWORD = process.env.E2E_PASSWORD ?? "Demo-UtEjEEuvXJWZJm";
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@demo.insurance-marketplace.example";
export const TAG = "E2E-PLAYWRIGHT";

export const AUTH_DIR = join(here, "..", ".auth");
export const STATE = { admin: join(AUTH_DIR, "admin.json") };

/** Signs in through the real staff sign-in page. With ADMIN_MFA_REQUIRED=false the MFA gate redirects straight through. */
export async function signInAsAdmin(page, { email = ADMIN_EMAIL, password = PASSWORD, next = "/" } = {}) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`, { waitUntil: "networkidle" });
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  // SignInForm → /mfa?next=… → (MFA off) → next
  await page.waitForURL((url) => url.pathname === next && !url.pathname.startsWith("/mfa"), { timeout: 45_000 });
}

export { a11ySmoke, runAxe, structuralChecks, watchConsole } from "../../../web/e2e/support/a11y.js";
