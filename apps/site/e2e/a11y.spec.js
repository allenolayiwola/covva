// Accessibility smoke for the marketing site: one h1, labelled controls, alt text, axe (when available), no console errors.
import { test } from "playwright/test";
import { a11ySmoke } from "./support/a11y.js";

const PUBLIC = ["/", "/explore", "/explore/motor", "/how-it-works", "/get-started", "/support", "/contact", "/brokers", "/insurers", "/trust", "/this-page-does-not-exist"];

test.describe("public pages", () => {
  for (const path of PUBLIC) test(`a11y ${path}`, async ({ page }, testInfo) => a11ySmoke(page, path, testInfo));
});
