// Pre-launch gate (lib/site-gate.ts). Runs against a second server on the same build with SITE_GATE=waitlist,
// SITE_GATE_HOSTS=localhost (playwright.config.js → e2e/support/start-gated.mjs). http://127.0.0.1 on that port is an
// ungated host. The main server (gate off) checks that nothing changes when the flag is unset.
import { test, expect } from "playwright/test";
import { TAG } from "./support/env.js";

const PORT = Number(process.env.E2E_GATED_PORT ?? 3104);
const GATED = process.env.E2E_GATED_URL ?? `http://localhost:${PORT}`;
const UNGATED_HOST = `http://127.0.0.1:${PORT}`;
const TOKEN = process.env.E2E_GATE_TOKEN ?? "e2e-preview-token-0123456789";
const WAITLIST_H1 = /Smarter insurance\s+is coming/;

test.skip(!!process.env.E2E_BASE_URL && !process.env.E2E_GATED_URL, "needs the gated server (set E2E_GATED_URL)");

test.describe("pre-launch gate on", () => {
  test("every page shows the waitlist, marked noindex, without the site navigation", async ({ page }) => {
    for (const path of ["/", "/insurance/motor", "/waitlist", "/about"]) {
      const res = await page.goto(`${GATED}${path}`);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
      expect(new URL(page.url()).pathname, "the address bar keeps the visited path").toBe(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(WAITLIST_H1);
      await expect(page.locator("meta[name='robots']").first()).toHaveAttribute("content", /noindex/);
    }
    await expect(page.getByRole("button", { name: "Insurance" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Join the waitlist" })).toBeVisible();
  });

  test("the teaser gives nothing away: one form with name, email and consent only", async ({ page }) => {
    await page.goto(GATED);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(WAITLIST_H1);
    await expect(page.getByRole("heading")).toHaveCount(1);
    await expect(page.locator("form")).toHaveCount(1);
    const form = page.locator("#join form");
    await expect(form.getByLabel("Your name")).toBeVisible();
    await expect(form.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(form.getByRole("checkbox")).toBeVisible();
    // Only those visible fields (hidden inputs and the off-screen honeypot aside).
    await expect(form.locator("input:visible:not([name=company_website]), select:visible, textarea:visible")).toHaveCount(3);
    await expect(form.locator("input[name=company_website]")).toHaveCount(1); // the spam honeypot is still there
    await expect(page.locator("img:not([alt='Covva'])")).toHaveCount(0);
    const text = await page.locator("body").innerText();
    for (const detail of [/MoMo/i, /broker/i, /insurer/i, /premium/i, /commission/i, /Paystack/i, /launch partner/i, /diaspora/i, /GBP|USD|EUR|CAD/, /motor|travel|health|funeral/i]) {
      expect(text, String(detail)).not.toMatch(detail);
    }
  });

  test("links into the app land on the waitlist instead of the app", async ({ page }) => {
    for (const path of ["/quote?type=motor", "/account", "/sign-in"]) {
      const res = await page.goto(`${GATED}${path}`);
      expect(res.status(), path).toBe(200);
      expect(new URL(page.url()).origin, path).toBe(GATED);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(WAITLIST_H1);
    }
  });

  test("legal pages stay reachable from the waitlist footer", async ({ page }) => {
    await page.goto(GATED);
    for (const [name, path] of [["Privacy", "/legal/privacy"], ["Terms", "/legal/terms"], ["Cookies", "/legal/cookies"]]) {
      await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name }).click();
      await expect(page).toHaveURL(`${GATED}${path}`);
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(WAITLIST_H1);
      await page.goBack();
    }
  });

  test("robots.txt lists no sitemap and the sitemap is gone", async ({ request }) => {
    const robots = await request.get(`${GATED}/robots.txt`);
    expect(robots.status()).toBe(200);
    expect(await robots.text()).not.toMatch(/sitemap/i);
    expect((await request.get(`${GATED}/sitemap.xml`)).status()).toBe(404);
  });

  test("the team preview link shows the full site; ?preview=off turns it off", async ({ page, context }) => {
    await page.goto(`${GATED}/?preview=not-the-secret-at-all`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(WAITLIST_H1);
    expect((await context.cookies()).find((c) => c.name === "covva_preview")).toBeUndefined();

    await page.goto(`${GATED}/insurance/motor?ref=ABC123&preview=${TOKEN}`);
    await expect(page).toHaveURL(`${GATED}/insurance/motor?ref=ABC123`); // the secret leaves the address bar
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(WAITLIST_H1);
    const cookie = (await context.cookies()).find((c) => c.name === "covva_preview");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.value).not.toContain(TOKEN);

    await page.goto(GATED);
    await expect(page.getByRole("button", { name: "Insurance" })).toBeVisible();

    await page.goto(`${GATED}/?preview=off`);
    await expect(page).toHaveURL(`${GATED}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(WAITLIST_H1);
  });

  test("hosts outside SITE_GATE_HOSTS see the normal site", async ({ page }) => {
    const res = await page.goto(UNGATED_HOST);
    expect(res.headers()["x-robots-tag"]).toBeUndefined();
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(WAITLIST_H1);
    await expect(page.getByRole("button", { name: "Insurance" })).toBeVisible();
  });

  test("joining the waitlist from a gated page saves a tagged lead", async ({ page }) => {
    await page.goto(`${GATED}/insurance/motor`);
    const form = page.locator("#join");
    await page.waitForTimeout(2_700); // bot guard: minimum fill time (lead form, same as the renewal reminder test)
    await form.getByLabel("Your name").fill(`${TAG} Waitlist gate`);
    await form.getByLabel("Email", { exact: true }).fill("e2e-waitlist@example.com");
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(form.getByText("You’re on the list.")).toBeVisible();
  });

  for (const width of [360, 768, 1280]) {
    test(`the waitlist fits a ${width}px screen without sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(GATED);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});

test.describe("pre-launch gate off (default)", () => {
  test("pages, robots.txt and the sitemap behave as before", async ({ page, request }) => {
    const res = await page.goto("/");
    expect(res.headers()["x-robots-tag"]).toBeUndefined();
    await expect(page.getByRole("button", { name: "Insurance" })).toBeVisible();
    expect((await request.get("/sitemap.xml")).status()).toBe(200);
    expect((await request.get("/robots.txt")).status()).toBe(200);
  });

  test("the waitlist page itself is never indexed", async ({ page }) => {
    await page.goto("/coming-soon");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(WAITLIST_H1);
    await expect(page.locator("meta[name='robots']").first()).toHaveAttribute("content", /noindex/);
  });
});
