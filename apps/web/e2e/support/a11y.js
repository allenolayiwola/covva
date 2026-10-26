// Lightweight accessibility + hygiene checks shared by both apps' e2e suites.
// Uses axe-core when it can be found in the pnpm store (it is a transitive dependency of
// eslint-config-next); otherwise falls back to structural checks only.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "playwright/test";

// Playwright transpiles these files to CommonJS, so __dirname is available (import.meta is not).
const here = __dirname;

function repoRoot() {
  let dir = here;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return null;
}

/** Path to axe.min.js, or null when axe-core is not available. */
export function findAxe() {
  const root = repoRoot();
  const candidates = [];
  if (root) {
    candidates.push(join(root, "node_modules", "axe-core", "axe.min.js"));
    const store = join(root, "node_modules", ".pnpm");
    if (existsSync(store)) {
      for (const entry of readdirSync(store)) {
        if (entry.startsWith("axe-core@")) candidates.push(join(store, entry, "node_modules", "axe-core", "axe.min.js"));
      }
    }
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Console errors and uncaught page errors, with a few known-benign patterns filtered out. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /third-party cookie/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,
  /favicon\.ico/i,
];

export function watchConsole(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(`${msg.location()?.url ?? page.url()}: ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message.slice(0, 300)}`));
  return errors;
}

/**
 * Structural smoke: exactly one <h1>, every <img> has alt text, every form control is labelled,
 * and a `main` landmark exists.
 */
export async function structuralChecks(page) {
  await expect(page.locator("h1"), "exactly one h1").toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
  const imgsWithoutAlt = await page.locator("img:not([alt])").count();
  expect(imgsWithoutAlt, "images without alt").toBe(0);
  const unlabelled = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
      const labelled = el.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label");
      if (!labelled) out.push(`${el.tagName.toLowerCase()}#${el.id || ""}[name=${el.getAttribute("name") || ""}]`);
    }
    return out;
  });
  expect(unlabelled, "unlabelled form controls").toEqual([]);
}

/**
 * Known, product-owned axe findings (see docs/TESTING.md → Known limitations). They are still attached to
 * every test as `axe-violations.json`, but do not fail the run until the design tokens / components are fixed:
 *  - color-contrast: `--color-subtle` (#6F858C) on white is ~4.1:1, below the 4.5:1 AA threshold for small text.
 *  - scrollable-region-focusable: the sample `<pre>` block on /insurers scrolls but is not keyboard focusable.
 *  - link-in-text-block: admin overview has an inline link distinguished from its paragraph by colour only.
 *  - aria-meter-name: the admin `<Meter>` (launch-gate progress on /categories) has no accessible name.
 * Override with E2E_AXE_ALLOWLIST="" to make them fail, or E2E_AXE_ALLOWLIST="a,b" to replace the list.
 */
const DEFAULT_AXE_ALLOWLIST = ["color-contrast", "scrollable-region-focusable", "link-in-text-block", "aria-meter-name"];
export const AXE_ALLOWLIST = new Set(
  (process.env.E2E_AXE_ALLOWLIST === undefined ? DEFAULT_AXE_ALLOWLIST : process.env.E2E_AXE_ALLOWLIST.split(",")).map((s) => s.trim()).filter(Boolean),
);

/** Runs axe-core (WCAG 2.0/2.1 A + AA). Returns `null` when axe is unavailable. */
export async function runAxe(page, testInfo) {
  const axePath = findAxe();
  if (!axePath) return null;
  await page.addScriptTag({ path: axePath });
  const results = await page.evaluate(async () => {
    return await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
  });
  const summary = results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
  if (testInfo) await testInfo.attach("axe-violations.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  const blocking = summary.filter((v) => ["critical", "serious"].includes(v.impact) && !AXE_ALLOWLIST.has(v.id));
  expect(blocking, `axe critical/serious violations on ${page.url()}:\n${JSON.stringify(blocking, null, 2)}`).toEqual([]);
  return summary;
}

/** Full smoke for one page: navigate, settle, structural checks, axe, no console errors. */
export async function a11ySmoke(page, path, testInfo, { waitFor } = {}) {
  const errors = watchConsole(page);
  await page.goto(path, { waitUntil: "networkidle" });
  if (waitFor) await expect(waitFor(page)).toBeVisible();
  await structuralChecks(page);
  const axe = await runAxe(page, testInfo);
  if (axe === null && testInfo) testInfo.annotations.push({ type: "note", description: "axe-core not found; structural checks only" });
  expect(errors, "console/page errors").toEqual([]);
}
