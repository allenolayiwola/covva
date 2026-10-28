import { test, expect } from "playwright/test";
import { STATE, TAG } from "./support/env.js";
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
  // Diaspora bundle page (product_bundles seed: Parents' Care Pack)
  { path: "/bundles/parents-care-pack", h1: /Parents. Care Pack/i },
];

test.describe("marketing site", () => {
  test("home renders the hero, quote card and product tiles", async ({ page }) => {
    await page.goto("/");
    // One h1: slide 1's headline, server-rendered.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Protect what matters. Wherever you are.");
    const card = page.getByRole("form", { name: "What would you like to insure?" });
    await expect(card).toBeVisible();
    // Six categories; the family slide preselects Health.
    await expect(card.getByRole("radio")).toHaveCount(6);
    await expect(card.getByRole("radio", { name: "Health" })).toBeChecked();
    await expect(card.getByRole("button", { name: /Compare quotes/ })).toBeVisible();
    await expect(card.getByText("Cover begins only after insurer acceptance and policy issuance.")).toBeVisible();
    // Slide controls and the Pause control (WCAG 2.2.2); the trust strip under the hero.
    const slides = page.getByRole("list", { name: "Choose a slide" });
    await expect(slides.getByRole("button")).toHaveCount(4);
    await expect(slides.getByRole("button", { name: /^Family, slide 1 of 4/ })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("button", { name: "Pause slideshow" })).toBeVisible();
    for (const t of ["Licensed insurers & brokers", "Pay with MoMo or card", "Premiums paid to the insurer"]) {
      await expect(page.getByRole("region", { name: "Why you can trust Covva" }).getByText(t)).toBeVisible();
    }
    // The hero photo is real content with alt text; the header sits transparent over it at the top.
    await expect(page.locator("[data-hero-media='family'] img")).toHaveAttribute("alt", /mother/);
    await expect(page.locator("[data-site-header]")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.mouse.wheel(0, 600);
    await expect(page.locator("[data-site-header]")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
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

  test("home hero carousel: autoplay, slide controls, picker preselection and Pause", async ({ page }) => {
    await page.goto("/");
    const slides = page.getByRole("list", { name: "Choose a slide" });
    const card = page.getByRole("form", { name: "What would you like to insure?" });
    // Autoplay moves on after ~7 s (the pointer never enters the hero) and the picker follows the slide.
    await expect(slides.getByRole("button", { name: /^Motor, slide 2 of 4/ })).toHaveAttribute("aria-current", "true", { timeout: 12_000 });
    await expect(card.getByRole("radio", { name: "Motor" })).toBeChecked();
    // The visible copy follows the slide; the single h1 stays slide 1's and inactive slides are hidden from AT.
    await expect(page.locator("[data-hero-copy='motor']")).toContainText("A bad day on the road.");
    await expect(page.locator("[data-hero-copy='motor']")).not.toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("[data-hero-copy='home']")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Protect what matters. Wherever you are.");
    // Pause (without hovering, so only the button is stopping it) freezes the progress bar.
    await page.getByTestId("hero-pause").evaluate((b) => b.click());
    await expect(page.getByTestId("hero-pause")).toHaveAccessibleName("Play slideshow");
    await expect(page.getByTestId("hero-progress")).toHaveCSS("animation-play-state", "paused");
    // Choosing a slide by hand preselects its cover until the visitor picks one themselves.
    await slides.getByRole("button", { name: /^Home/ }).click();
    await expect(card.getByRole("radio", { name: "Home" })).toBeChecked();
    await card.getByRole("radio", { name: "Travel" }).check({ force: true });
    await slides.getByRole("button", { name: /^Phone/ }).click();
    await expect(page.locator("[data-hero-copy='phone']")).toContainText("In your pocket.");
    await expect(card.getByRole("radio", { name: "Travel" })).toBeChecked();
    await card.getByRole("button", { name: /Compare quotes/ }).click();
    await page.waitForURL(/\/quote\?category=travel/);
  });

  test("home hero with reduced motion: no autoplay, no zoom, instant swaps", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const slides = page.getByRole("list", { name: "Choose a slide" });
    await expect(page.getByTestId("hero-pause")).toHaveAccessibleName("Play slideshow");
    await expect(page.locator("[data-hero-media='family'] .hero-photo")).toHaveCSS("animation-name", "none");
    await page.waitForTimeout(8_500);
    await expect(slides.getByRole("button", { name: /^Family/ })).toHaveAttribute("aria-current", "true");
    await slides.getByRole("button", { name: /^Motor/ }).click();
    await expect(page.locator("[data-hero-media='motor']")).toHaveCSS("transition-property", "none");
    await expect(page.locator("[data-hero-media='motor']")).toHaveCSS("opacity", "1");
    await expect(page.getByRole("form", { name: "What would you like to insure?" }).getByRole("radio", { name: "Motor" })).toBeChecked();
  });

  test("hero quote card hands over to /quote and the flow asks one question per screen", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("form", { name: "What would you like to insure?" });
    await card.getByRole("radio", { name: "Health" }).check({ force: true });
    await card.getByRole("button", { name: /Compare quotes/ }).click();
    await page.waitForURL(/\/quote\?category=health/);
    // Step 2 of 6: the first question for health cover, with a progress bar and the sticky bar.
    await expect(page.getByText(/Step 2 of 6/)).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Quote progress" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
    // Required answers are enforced before moving on.
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    // Fill the health questions: members + age, plan level (cards), pre-existing (yes/no), region.
    await page.getByLabel("People to cover").fill("3");
    await page.getByLabel("Age of oldest member").fill("45");
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("radio").first().check({ force: true });
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("radio", { name: "No" }).check({ force: true });
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByLabel(/region/i).selectOption("Greater Accra");
    await page.getByRole("button", { name: /Continue/ }).click();
    // Review, then the sign-in gate (anonymous): brokers are chosen only after sign-in.
    await expect(page.getByRole("heading", { level: 1, name: "Check your answers" })).toBeVisible();
    await expect(page.getByText("A quote request is not cover.").first()).toBeVisible();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to choose your brokers" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Continue with phone/ })).toHaveAttribute("href", /\/sign-in\?method=phone&next=%2Fquote%3Fresume%3D1/);
  });

  test("quote flow Back works on a deep link with no earlier step history", async ({ page }) => {
    await page.goto("/quote?category=motor");
    await expect(page.getByText(/Step 2 of 6/)).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/quote/);
    await expect(page.getByRole("heading", { level: 1, name: "What do you want to insure?" })).toBeVisible();
  });

  test("signed-in customer reaches the broker picker and the button counts brokers", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: STATE.customer, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto("/quote?category=travel");
    for (let i = 0; i < 8 && !(await page.getByRole("heading", { level: 1, name: "Check your answers" }).isVisible()); i++) {
      const radios = page.getByRole("radio");
      if ((await radios.count()) > 0) await radios.first().check({ force: true });
      for (const input of await page.locator("input[type='number']:visible").all()) await input.fill("2");
      for (const input of await page.locator("input[type='date']:visible").all()) await input.fill("2027-03-01");
      await page.getByRole("button", { name: /Continue/ }).click();
    }
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Choose up to three brokers" })).toBeVisible();
    const send = page.getByRole("button", { name: /Send to/ });
    await expect(send).toBeDisabled();
    const brokers = page.getByRole("checkbox", { name: /./ });
    await brokers.nth(0).check({ force: true });
    await expect(send).toHaveText(/Send to 1 broker\b/);
    if ((await brokers.count()) > 1) {
      await brokers.nth(1).check({ force: true });
      await expect(send).toHaveText(/Send to 2 brokers/);
    }
    await ctx.close();
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

  test("learn hub shows no 'coming soon' language promises while only English exists", async ({ page }) => {
    await page.goto("/learn/third-party-vs-comprehensive");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const ld = await page.locator("script[type='application/ld+json']").allTextContents();
    expect(ld.some((t) => t.includes('"Article"'))).toBe(true);
    await expect(page.getByLabel("Language")).toHaveCount(0);
    await expect(page.getByText(/coming soon/i)).toHaveCount(0);
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

  test("consent banner: 'Choose for me' saves analytics-only and the cookie notice can reset it", async ({ page }) => {
    await page.goto("/about");
    const region = page.getByRole("region", { name: "Cookie consent" });
    await region.getByRole("button", { name: "Choose for me" }).click();
    // Strictly necessary is always on and cannot be unticked.
    await expect(region.getByRole("checkbox", { name: /Strictly necessary/ })).toBeDisabled();
    await expect(region.getByRole("checkbox", { name: /Analytics/ })).toBeChecked();
    await region.getByRole("button", { name: "Save choices" }).click();
    await expect(region).toBeHidden();
    let cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "covva_consent")?.value).toBe("analytics");
    // Without a GA4 id configured, nothing is injected even after consent.
    await expect(page.locator("script#ga4-src")).toHaveCount(0);
    await expect(page.locator("script#meta-pixel-src")).toHaveCount(0);
    // The cookie notice lets the visitor change their mind: the banner comes back.
    await page.goto("/legal/cookies");
    await expect(page.getByRole("status")).toContainText("analytics only");
    await page.getByRole("button", { name: "Change your cookie choices" }).click();
    await expect(page.getByRole("region", { name: "Cookie consent" })).toBeVisible();
    cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "covva_consent")).toBeUndefined();
  });

  test("A/B hooks: control by default, ?exp= override is sticky and limited to known variants", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("Protect what matters. Wherever you are.");
    const exp = page.locator("[data-experiment='home_hero_headline']");
    await expect(exp).toHaveAttribute("data-variant", "control");
    expect((await page.context().cookies()).find((c) => c.name === "covva_exp")).toBeUndefined();
    // QA override forces a variant and persists it for the browser.
    await page.goto("/?exp=home_hero_headline:instant");
    await expect(exp).toHaveAttribute("data-variant", "instant");
    await expect(exp).toContainText("Compare quotes from licensed brokers in minutes");
    expect(decodeURIComponent((await page.context().cookies()).find((c) => c.name === "covva_exp")?.value ?? "")).toBe("home_hero_headline:instant");
    await page.goto("/");
    await expect(exp).toHaveAttribute("data-variant", "instant");
    // Unknown variants are ignored and the stored assignment is kept.
    await page.goto("/?exp=home_hero_headline:nope");
    await expect(exp).toHaveAttribute("data-variant", "instant");
    await page.goto("/?exp=home_hero_headline:control");
    await expect(exp).toContainText("Compare insurance quotes from licensed brokers in Ghana");
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
    await expect(page).toHaveTitle(/Compare Motor cover/);
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

test.describe("embedded quote widget", () => {
  test("an unknown partner code renders a friendly not-available state (and is never framable by others)", async ({ page }) => {
    const res = await page.goto("/embed/quote?partner=bad");
    expect(res?.status()).toBe(200);
    expect(res?.headers()["x-frame-options"]).toBeUndefined();
    expect(res?.headers()["content-security-policy"] ?? "").toContain("frame-ancestors 'self'");
    await expect(page.getByTestId("embed-unavailable")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /aren.t available here right now/ })).toBeVisible();
    await expect(page.getByText("Technology provided by Covva. Insurance provided by licensed insurers and brokers.")).toBeVisible();
  });
});

test.describe("site-wide language switcher (Phase 3 i18n)", () => {
  test("English pages are unchanged by the translation layer", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GH");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Protect what matters. Wherever you are.");
    await expect(page.getByRole("heading", { level: 2, name: "What would you like to insure?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare quotes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "For partners" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText("Technology platform. Not an insurer or broker.");
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Diaspora" })).toBeVisible();
    await expect(page.getByTestId("locale-notice")).toHaveCount(0);
  });

  test("choosing Twi in the header is honest: English text with an in-progress notice", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/");
    const header = page.getByRole("banner");
    await header.getByRole("button", { name: "Language: English" }).click();
    await header.getByRole("button", { name: /^Twi/ }).click();
    await expect(page.getByTestId("locale-notice")).toContainText("Twi translations are in progress — untranslated text is shown in English.");
    await expect(page.locator("html")).toHaveAttribute("lang", "tw");
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "covva_lang")?.value).toBe("tw");
    // Nothing is machine-translated: the page stays in English.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Protect what matters. Wherever you are.");

    // The choice survives a reload (cookie → <html lang> script, notice after hydration).
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "tw");
    await expect(page.getByTestId("locale-notice")).toBeVisible();
    await expect(header.getByRole("button", { name: "Language: Twi" })).toBeVisible();

    // The catalogue API reports the honest status.
    const res = await page.request.get("/api/v1/i18n/tw");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(["planned", "partial", "complete"]).toContain(body.data.status);
    expect(body.data.fallback).toBe("en");

    // Back to English: notice gone.
    await header.getByRole("button", { name: "Language: Twi" }).click();
    await header.getByRole("button", { name: /^English/ }).click();
    await expect(page.getByTestId("locale-notice")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GH");
  });
});

test.describe("micro cover page (Phase 3)", () => {
  test("/micro renders one h1, the audiences and a product grid or the coming-soon note", async ({ page }) => {
    const res = await page.goto("/micro");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Cover by the day/i);
    await expect(page.getByRole("list", { name: "Who it is for" })).toContainText("Okada riders");
    const buy = page.getByRole("link", { name: "Buy cover" });
    if ((await buy.count()) > 0) await expect(buy.first()).toHaveAttribute("href", /\/account\/micro\/buy\?version=/);
    else await expect(page.getByText(/Micro cover is coming soon/)).toBeVisible();
    const api = await page.request.get("/api/v1/micro/products?audience=okada");
    expect(api.ok()).toBe(true);
    expect(Array.isArray((await api.json()).data.items)).toBe(true);
  });
});
