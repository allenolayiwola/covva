import { test, expect } from "playwright/test";
import { TAG } from "./support/env.js";

test.describe("marketing site", () => {
  test("home renders the hero copy and category cards", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText("Find cover.");
    await expect(h1).toContainText("Move forward.");
    await expect(page.getByRole("link", { name: "What do I need?" }).first()).toHaveAttribute("href", "/get-started");
    await expect(page.getByRole("heading", { level: 2, name: "Cover for what matters to you" })).toBeVisible();
    const cards = page.locator("a[href^='/explore/']");
    expect(await cards.count()).toBeGreaterThanOrEqual(5);
    await expect(page.getByRole("link", { name: /^Motor/ }).first()).toBeVisible();
    // Platform never presents itself as an insurer or broker.
    await expect(page.getByText(/not an insurer or broker/i).first()).toBeVisible();
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
});
