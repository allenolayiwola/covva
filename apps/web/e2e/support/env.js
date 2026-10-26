// Demo accounts and tags shared by the web e2e specs. Everything comes from env with the known
// demo defaults so a local run needs no configuration.
import { join } from "node:path";

// Playwright transpiles these files to CommonJS, so __dirname is available (import.meta is not).
const here = __dirname;

export const PASSWORD = process.env.E2E_PASSWORD ?? "Demo-UtEjEEuvXJWZJm";
export const ACCOUNTS = {
  customer: process.env.E2E_CUSTOMER_EMAIL ?? "ama@demo-customer.example",
  broker: process.env.E2E_BROKER_EMAIL ?? "kofi@demo-broker.example",
  adviser: process.env.E2E_ADVISER_EMAIL ?? "abena@demo-broker.example",
  insurer: process.env.E2E_UNDERWRITER_EMAIL ?? "underwriter@coastline.example",
  claims: process.env.E2E_CLAIMS_EMAIL ?? "claims@coastline.example",
};

/** Every row the browser tests create carries this prefix so it can be purged. */
export const TAG = "E2E-PLAYWRIGHT";

export const AUTH_DIR = join(here, "..", ".auth");
export const STATE = {
  customer: join(AUTH_DIR, "customer.json"),
  broker: join(AUTH_DIR, "broker.json"),
  insurer: join(AUTH_DIR, "insurer.json"),
};

/**
 * Signs in through the real /sign-in page (email + password tab) and waits for the redirect.
 * `next` keeps partner users out of the customer onboarding redirect.
 */
export async function signInViaForm(page, { email, password = PASSWORD, next = "/account" }) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`, { waitUntil: "networkidle" }); // settle hydration before typing
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname.startsWith(next.split("?")[0]), { timeout: 45_000 });
}
