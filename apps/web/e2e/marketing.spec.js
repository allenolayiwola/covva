import { test, expect } from "playwright/test";
import { TAG } from "./support/env.js";
import { a11ySmoke } from "./support/a11y.js";

/** Addendum 5 routes: each must respond 200, render exactly one h1 and pass the shared axe smoke. */
const NEW_ROUTES = [
  { path: "/insurance/motor", h1: /Motor insurance/i },
  { path: "/insurance/home", h1: /home/i },
  { path: "/insurance/health", h1: /health/i },
  { path: "/insurance/travel", h1: /Travel/i },
  { path: "/insurance/life-funeral", h1: /Dignity/i },
  { path: "/insurance/business", h1: /shop|Business/i },
  { path: "/insurance/micro", h1: /Small premiums/i },
  { path: "/diaspora", h1: /Look after your family in Ghana/i },
  { path: "/claims", h1: /Something happened/i },
  { path: "/verify", h1: /Is this policy/i },
  { path: "/partners/embedded", h1: /Insurance inside/i },
  { path: "/learn", h1: /explained simply/i },
  { path: "/learn/how-to-make-a-claim", h1: /How to make an insurance claim/i },
  { path: "/referrals", h1: /worth/i },
  { path: "/waitlist", h1: /Be first/i },
  { path: "/press", h1: /Media kit/i },
];

test.describe("marketing site", () => {
  test("home renders the hero, quote widget and product tiles", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText("Compare, buy and manage insurance");
    await expect(h1).toContainText("in minutes");
    await expect(page.getByRole("form", { name: "Get an instant quote" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Cover for what matters to you" })).toBeVisible();
    const tiles = page.locator("a[href^='/insurance/']");
    expect(await tiles.count()).toBeGreaterThanOrEqual(7);
    await expect(page.getByRole("link", { name: /^Motor/ }).first()).toBeVisible();
    await expect(page.getByText("Licensed partners only").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Protect your family back home." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Are you an insurer or broker/ })).toBeVisible();
    // Testimonials are placeholders until real reviews exist and must say so.
    expect(await page.getByText("Illustrative", { exact: true }).count()).toBeGreaterThanOrEqual(3);
    // Platform never presents itself as an insurer or broker.
    await expect(page.getByText(/not an insurer or broker/i).first()).toBeVisible();
  });

  test("hero quote widget hands over to /get-started with the category and registration", async ({ page }) => {
    await page.goto("/");
    const form = page.getByRole("form", { name: "Get an instant quote" });
    await form.getByLabel("What do you want to insure?").selectOption("motor");
    await form.getByLabel(/Vehicle registration/).fill("GX 1234-24");
    await form.getByRole("button", { name: "Get quotes" }).click();
    await page.waitForURL(/\/get-started\?category=motor/);
    expect(page.url()).toContain("reg=GX");
    await expect(page.getByRole("heading", { level: 2, name: /Motor quotes/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Get quotes/ }).first()).toHaveAttribute("href", /\/account\/requests\/new\?category=motor/);
  });

  for (const r of NEW_ROUTES) {
    test(`route ${r.path} renders (200, h1, axe smoke)`, async ({ page, request }, testInfo) => {
      const res = await request.get(r.path);
      expect(res.status()).toBe(200);
      await a11ySmoke(page, r.path, testInfo);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(r.h1);
    });
  }

  test("product page explains third party vs comprehensive and verification", async ({ page }) => {
    await page.goto("/insurance/motor");
    await expect(page.getByRole("heading", { level: 2, name: /Third party vs comprehensive/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Sticker and QR verification" })).toBeVisible();
    await expect(page.getByText(/GH₵ \d+/).first()).toBeVisible();
    await expect(page.getByText("Indicative").first()).toBeVisible();
    await expect(page.getByRole("form", { name: /Motor quotes/ })).toBeVisible();
    const ld = await page.locator("script[type='application/ld+json']").allTextContents();
    expect(ld.filter((t) => t.includes('"Product"'))).toHaveLength(1);
  });

  test("unknown product line renders the not-found page (noindex)", async ({ page }) => {
    await page.goto("/insurance/does-not-exist");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/couldn.t find that page/i);
    await expect(page.locator("meta[name='robots']").first()).toHaveAttribute("content", /noindex/);
  });

  test("diaspora currency switcher converts the example prices", async ({ page }) => {
    await page.goto("/diaspora");
    await expect(page.getByRole("button", { name: "GBP" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/£/).first()).toBeVisible();
    await page.getByRole("button", { name: "USD" }).click();
    await expect(page.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/\$/).first()).toBeVisible();
    await expect(page.getByText(/final price in your currency/i)).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Parents’ Care Pack" })).toBeVisible();
  });

  test("verify page prefills ?q= and the API never returns customer data", async ({ page, request }) => {
    await page.goto("/verify?q=COV-TEST-000");
    await expect(page.getByLabel("Policy number")).toHaveValue("COV-TEST-000");
    const bad = await request.post("/api/public/verify-policy", { data: { insurer: "", policyNumber: "" } });
    expect(bad.status()).toBe(400);
    const res = await request.post("/api/public/verify-policy", { data: { insurer: "no-such-insurer", policyNumber: "COV-TEST-000" } });
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body.valid).toBe(false);
    for (const k of Object.keys(body)) expect(["valid", "status", "insurerName", "coverStart", "coverEnd", "categoryName", "message"]).toContain(k);
  });

  test("learn hub language switcher is honest about translations", async ({ page }) => {
    await page.goto("/learn/third-party-vs-comprehensive");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const ld = await page.locator("script[type='application/ld+json']").allTextContents();
    expect(ld.some((t) => t.includes('"Article"'))).toBe(true);
    await page.getByLabel("Language").selectOption("tw");
    await expect(page.getByRole("status")).toContainText(/Twi translations are coming soon/);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "covva_lang")?.value).toBe("tw");
  });

  test("consent banner stores the choice in a cookie and goes away", async ({ page }) => {
    await page.goto("/about");
    const region = page.getByRole("region", { name: "Cookie consent" });
    await expect(region).toBeVisible();
    await region.getByRole("button", { name: "Essential only" }).click();
    await expect(region).toBeHidden();
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "covva_consent")?.value).toBe("essential");
    await page.reload();
    await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
  });

  test("header navigation exposes the Insurance and Partners menus to the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const insurance = page.getByRole("button", { name: "Insurance" });
    await insurance.focus();
    await page.keyboard.press("ArrowDown");
    await expect(insurance).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: /^Motor/ }).first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(insurance).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Partners" })).toBeVisible();
  });

  test("renewal reminder sign-up captures a tagged lead", async ({ page }) => {
    await page.goto("/");
    const form = page.getByRole("form", { name: "Already insured? Let us remind you." });
    await form.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2_700); // bot guard: minimum fill time
    await form.getByLabel("Type of policy").selectOption("motor");
    await form.getByLabel("Current policy expires on").fill("2027-06-30");
    await form.getByLabel("Your name").fill(`${TAG} Reminder`);
    await form.getByLabel("Phone or email").fill("0241234567");
    await form.getByRole("button", { name: "Remind me" }).click();
    await expect(page.getByRole("status")).toContainText("Reminder set.");
  });

  test("category landing page /explore/motor", async ({ page }) => {
    await page.goto("/explore/motor");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Motor");
    await expect(page.getByRole("heading", { level: 2, name: "Participating insurers" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "What you will need" })).toBeVisible();
    await expect(page).toHaveTitle(/Motor insurance in Ghana/);
  });

  test("unknown category renders the not-found page (noindex)", async ({ page }) => {
    // The 404 is raised inside a streamed Suspense boundary, so the HTTP status is 200 + noindex (see docs/NEXT16_NOTES.md §8).
    await page.goto("/explore/does-not-exist");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/couldn.t find that page/i);
    await expect(page.locator("meta[name='robots']").first()).toHaveAttribute("content", /noindex/);
  });

  test("shared quotes: a bad token renders the not-found page (noindex) and never leaks data", async ({ page }) => {
    await page.goto("/q/not-a-real-token");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/couldn.t find that page/i);
    await expect(page.locator("meta[name='robots']").first()).toHaveAttribute("content", /noindex/);
    // A well-formed but unknown token behaves the same.
    await page.goto(`/q/${"a".repeat(48)}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/couldn.t find that page/i);
  });

  test("how it works explains every role", async ({ page }) => {
    await page.goto("/how-it-works");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every step visible");
    expect(await page.getByRole("heading", { level: 2 }).count()).toBeGreaterThanOrEqual(3);
  });

  test("help-me-choose wizard: answering the questions shows suggestions", async ({ page }) => {
    await page.goto("/get-started");
    await expect(page.getByRole("heading", { level: 1, name: "What cover do I actually need?" })).toBeVisible();
    await expect(page.getByText("Question 1 of 8")).toBeVisible();

    await page.getByRole("button", { name: "Me and my family" }).click();
    await expect(page.getByText("Question 2 of 8")).toBeVisible();
    await page.getByRole("button", { name: "Employed", exact: true }).click();
    await expect(page.getByText("Question 3 of 8")).toBeVisible();
    await page.getByText("A car, taxi or motorbike").click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Question 4 of 8")).toBeVisible();
    await page.getByRole("button", { name: "Yes", exact: true }).click(); // dependants
    await expect(page.getByText("Question 5 of 8")).toBeVisible();
    await page.getByRole("button", { name: "No", exact: true }).click(); // travel
    await expect(page.getByText("Question 6 of 8")).toBeVisible();
    await page.getByRole("button", { name: "NHIS only" }).click();
    await expect(page.getByText("Question 7 of 8")).toBeVisible();
    await page.getByRole("button", { name: "No", exact: true }).click(); // liability
    await expect(page.getByText("Question 8 of 8")).toBeVisible();
    await page.getByRole("button", { name: "GH₵ 100 – 500" }).click();

    await expect(page.getByRole("heading", { level: 2, name: "Here’s the cover worth considering" })).toBeVisible();
    const first = page.locator("ol > li").first();
    await expect(first.getByRole("heading", { level: 3 })).toHaveText("Motor");
    await expect(first.getByText("Essential")).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Life & funeral" })).toBeVisible();
    await expect(page.getByText("not advice and not a recommendation")).toBeVisible();
    await expect(page.locator("ol > li").first().getByRole("link", { name: "Start a request" })).toHaveAttribute("href", "/account/requests/new?category=motor");
  });

  test("support FAQ search filters answers", async ({ page }) => {
    await page.goto("/support");
    await expect(page.getByRole("heading", { level: 1, name: "How can we help?" })).toBeVisible();
    const search = page.getByLabel("Search help articles");
    await search.fill("claim");
    await expect(page.locator("p[aria-live='polite']").first()).toHaveText(/^\d+ results?$/);
    await expect(page.getByRole("heading", { level: 2, name: "Claims" })).toBeVisible();
    await search.fill("zzqqxx-no-such-topic");
    await expect(page.getByText(/No answers match/)).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
  });

  test("sitemap.xml and robots.txt are served", async ({ request }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()["content-type"]).toContain("xml");
    const xml = await sitemap.text();
    expect(xml).toContain("<urlset");
    expect(xml).toContain("/explore/motor");
    expect(xml).toContain("/how-it-works");
    for (const p of ["/insurance/motor", "/diaspora", "/claims", "/verify", "/partners/embedded", "/learn/how-to-make-a-claim", "/referrals", "/waitlist", "/press"]) expect(xml).toContain(p);

    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const txt = await robots.text();
    expect(txt).toMatch(/User-Agent: \*/i);
    expect(txt).toContain("Disallow: /account");
    expect(txt).toContain("Disallow: /partner/");
    expect(txt).toContain("Disallow: /api/");
    expect(txt).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });

  test("contact form validates and then submits", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.getByRole("heading", { level: 1, name: "Talk to us" })).toBeVisible();
    const form = page.locator("form").filter({ has: page.getByLabel("Your name") });

    // The server silently discards submissions made < 2.5 s after the form rendered (bot guard), so wait first.
    await page.waitForTimeout(2_700);
    // Validation: nothing filled in.
    await form.getByRole("button", { name: "Send message" }).click();
    await expect(form.getByRole("alert")).toContainText("Please check the highlighted fields");
    await expect(form.getByText("Please tell us your name.")).toBeVisible();

    await form.getByLabel("What is this about?").selectOption("customer");
    await form.getByLabel("Your name").fill(`${TAG} Tester`);
    await form.getByLabel("Email", { exact: true }).fill("e2e-playwright@example.com");
    await form.getByLabel("Cover you are interested in").selectOption("motor");
    await form.getByLabel("How can we help?").fill(`${TAG} automated contact-form check. Safe to delete.`);
    await form.getByLabel(/You may contact me about this enquiry/).check();
    await form.getByRole("button", { name: "Send message" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("Thank you — we’ve got your message.");
    await expect(status.getByRole("button", { name: "Send another message" })).toBeVisible();
  });

  test("chat drawer opens with the disclaimer and a way to reach a person", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Chat with us" }).click();
    const drawer = page.getByRole("dialog", { name: "Chat with us" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("chat-disclaimer")).toContainText("not an insurer or broker");
    await expect(drawer.getByText(/can.t recommend a product or quote a price/)).toBeVisible();
    await expect(drawer.getByRole("link", { name: /Talk to a human \/ my broker/ })).toBeVisible();
    await expect(drawer.getByLabel("Your question")).toBeVisible();
    await drawer.getByRole("button", { name: "Close chat" }).click();
    await expect(drawer).toBeHidden();
  });
});
