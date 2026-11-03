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

test('legal documents show the review notice', async ({ page }) => {
  for (const slug of ['terms', 'privacy', 'cookies', 'complaints', 'disclosures']) {
    await page.goto(`/legal/${slug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This document is under legal review.', { exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('[');
    await expect(page.locator('main')).toContainText(/to be confirmed before launch/i);
  }
});

// The bar's Reject/Accept are a real form (POST /api/consent), so a choice made before hydration still counts.
test('consent Reject works before the page has hydrated', async ({ page, context }) => {
  await context.clearCookies();
  // Block the app's JavaScript bundles so the page never hydrates (a very slow phone, frozen at first paint).
  // Every script under /_next/static (Vercel serves them from /_next/static/immutable/chunks/, local builds from /_next/static/chunks/).
  await page.route(/\/_next\/static\/.+\.js(\?.*)?$/, (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const banner = page.getByRole('region', { name: 'Cookie consent' });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: /^Settings/ })).toBeDisabled();
  await banner.getByRole('button', { name: /^Reject/ }).click();
  await expect(page).toHaveURL(/\/#consent-saved$/);
  await expect(banner).toHaveCount(0);
  const cookie = (await context.cookies()).find((c) => c.name === 'covva_consent');
  expect(cookie?.value).toBe('essential');
});

test('consent Reject works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(test.info().project.use.baseURL ?? 'http://localhost:3100');
  const banner = page.locator('[data-consent-banner]');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: /^Reject/ }).click();
  await expect(page).toHaveURL(/\/#consent-saved$/);
  await expect(banner).toBeHidden();
  expect((await context.cookies()).find((c) => c.name === 'covva_consent')?.value).toBe('essential');
  await context.close();
});

test('consent cannot be set by a post from another site', async ({ request }) => {
  const res = await request.post('/api/consent', {
    form: { choice: 'all' },
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
  expect(res.headers()['set-cookie']).toBeUndefined();
});
