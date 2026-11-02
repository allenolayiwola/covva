import { test, expect } from 'playwright/test';

for (const width of [360, 390, 768, 1024, 1280]) {
  test(`trust and phone controls at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('region', { name: 'How trust works at Covva' })).toHaveCount(1);
    await expect(page.locator('#stats-title')).toHaveCount(0);
    const banner = page.getByRole('region', { name: 'Cookie consent' });
    await expect(banner).toBeVisible();
    expect((await banner.boundingBox()).height).toBeLessThanOrEqual(844 * .25);
    for (const name of ['Accept', 'Reject', 'Settings']) await expect(banner.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
    await info.attach(`home-${width}`, { body: await page.screenshot({ caret: "initial" }), contentType: 'image/png' });
    await banner.getByRole('button', { name: /^Reject/ }).click();
    await expect(banner).toHaveCount(0);
    if (width < 768) {
      const trigger = page.getByRole('button', { name: 'Open menu' });
      await trigger.click();
      const menu = page.getByRole('dialog');
      await expect(menu).toBeVisible();
      await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
      const close = menu.getByRole('button', { name: 'Close menu' });
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(menu.getByRole('link', { name: 'My account' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      expect((await menu.boundingBox()).width).toBeLessThanOrEqual(width);
      await info.attach(`menu-${width}`, { body: await page.screenshot({ caret: "initial" }), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
      await trigger.click();
      await page.getByRole('dialog').getByRole('button', { name: 'Close menu' }).click();
      await expect(menu).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

// The cookie bar's Reject / Accept are a plain form (POST /api/consent), so they work before hydration and
// without JavaScript at all.
test('cookie bar Reject works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  const banner = page.getByRole('region', { name: 'Cookie consent' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: /^Reject/ }).click();
  await expect(page).toHaveURL(/\/about#cookie-consent$/);
  await expect(banner).toBeHidden();
  const cookie = (await context.cookies()).find((c) => c.name === 'covva_consent');
  expect(cookie?.value).toBe('essential');
  expect(cookie?.sameSite).toBe('Lax');
  expect(cookie?.httpOnly).toBe(false);
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 179 * 86400);
  await context.close();
});

test('cookie bar Reject works before hydration', async ({ page }) => {
  // Hold the JavaScript bundles back so the click is guaranteed to land before React hydrates (a slow phone).
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const scripts = /\/_next\/static\/chunks\/.*\.js$/;
  await page.route(scripts, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  const banner = page.getByRole('region', { name: 'Cookie consent' });
  await banner.getByRole('button', { name: /^Reject/ }).click();
  await expect(page).toHaveURL(/\/about#cookie-consent$/);
  await expect(banner).toBeHidden();
  release();
  await page.unroute(scripts);
  expect((await page.context().cookies()).find((c) => c.name === 'covva_consent')?.value).toBe('essential');
  // After hydration the bar is gone for good and the fragment is tidied away.
  await expect(banner).toHaveCount(0);
  await expect(page).toHaveURL(/\/about$/);
});

test('consent route refuses cross-site posts', async ({ request, baseURL }) => {
  const res = await request.post('/api/consent', { form: { choice: 'all' }, headers: { origin: 'https://evil.example' }, maxRedirects: 0 });
  expect(res.status()).toBe(403);
  const ok = await request.post('/api/consent', { form: { choice: 'all' }, headers: { origin: new URL(baseURL).origin, referer: `${baseURL}/partners?x=1` }, maxRedirects: 0 });
  expect(ok.status()).toBe(303);
  expect(ok.headers()['location']).toBe('/partners?x=1#cookie-consent');
  // No pixel ids in the e2e build, so "all" is stored as analytics only.
  expect(ok.headers()['set-cookie']).toMatch(/^covva_consent=analytics; Max-Age=15552000; Path=\/; SameSite=Lax/);
});

test('legal documents show the review notice', async ({ page }) => {
  for (const slug of ['terms', 'privacy', 'cookies', 'complaints', 'disclosures']) {
    await page.goto(`/legal/${slug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This document is under legal review.', { exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('[');
    await expect(page.locator('main')).toContainText(/to be confirmed before launch/i);
  }
});
