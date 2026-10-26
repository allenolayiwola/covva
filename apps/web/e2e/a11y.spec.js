// Accessibility smoke: one h1, labelled controls, alt text, axe (when available), no console errors.
import { test } from "playwright/test";
import { STATE } from "./support/env.js";
import { a11ySmoke } from "./support/a11y.js";

const PUBLIC = ["/", "/quote", "/quote?category=motor", "/explore", "/explore/motor", "/how-it-works", "/get-started", "/support", "/contact", "/brokers", "/insurers", "/trust", "/sign-in", "/sign-up", "/this-page-does-not-exist"];
const CUSTOMER = ["/account", "/account/policies", "/account/requests", "/account/requests/new", "/account/claims", "/account/messages", "/account/documents", "/account/profile"];
const BROKER = ["/partner", "/partner/requests", "/partner/quotes", "/partner/customers", "/partner/policies", "/partner/service", "/partner/settings"];
const INSURER = ["/partner/submissions", "/partner/issuance", "/partner/claims", "/partner/products"];

test.describe("public pages", () => {
  for (const path of PUBLIC) test(`a11y ${path}`, async ({ page }, testInfo) => a11ySmoke(page, path, testInfo));
});

test.describe("customer pages", () => {
  test.use({ storageState: STATE.customer });
  for (const path of CUSTOMER) test(`a11y ${path}`, async ({ page }, testInfo) => a11ySmoke(page, path, testInfo));
});

test.describe("broker pages", () => {
  test.use({ storageState: STATE.broker });
  for (const path of BROKER) test(`a11y ${path}`, async ({ page }, testInfo) => a11ySmoke(page, path, testInfo));
});

test.describe("insurer pages", () => {
  test.use({ storageState: STATE.insurer });
  for (const path of INSURER) test(`a11y ${path}`, async ({ page }, testInfo) => a11ySmoke(page, path, testInfo));
});
