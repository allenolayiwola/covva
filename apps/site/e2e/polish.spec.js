import { test, expect } from 'playwright/test';

test.describe('public error polish', () => {
  test('contact failure describes each invalid field and focuses a summary', async ({ page }) => {
    await page.goto('/contact', { waitUntil: 'domcontentloaded' });
    // Wait for the real anti-bot minimum fill duration without submitting a valid lead.
    await page.waitForFunction(() => {
      const started = Number(document.querySelector('input[name="started_at"]')?.value);
      return started > 0 && Date.now() - started >= 2500;
    });
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText('Please check the highlighted fields.')).toBeVisible();
    for (const name of ['name', 'email', 'consent']) {
      const field = page.locator(`[name="${name}"]`);
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      const describedBy = await field.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      await expect(page.locator(`[id="${describedBy}"]`)).toBeVisible();
    }
    await expect(page.getByRole('alert').getByRole('link')).toHaveCount(3);
  });
  // A URL nobody has requested before must get the full branded page server-side (not an empty shell that
  // only JavaScript can fill), so this runs with JavaScript off on a path unique to this run.
  test('a never-seen unknown URL is a full branded 404 without JavaScript', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const res = await page.goto(`${baseURL}/no-such-page-${Date.now()}-${Math.random().toString(36).slice(2)}/deeper`);
    expect(res.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('We couldn’t find that page.');
    await expect(page.getByRole('link', { name: 'Back to home', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Explore cover', exact: true })).toBeVisible();
    await expect(page.locator("meta[name='robots']").first()).toHaveAttribute('content', /noindex/);
    await context.close();
  });
  test('unknown cover is a real 404 with recovery links', async ({ page, request }) => {
    expect((await request.head('/cover/zzz')).status()).toBe(404);
    expect((await page.goto('/cover/zzz', { waitUntil: 'domcontentloaded' })).status()).toBe(404);
    await expect(page.getByRole('link', { name: 'Back to home', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Explore cover', exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Help centre', exact: true })).toBeVisible();
  });
});

test('verify placeholder fits a phone-width input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/verify', { waitUntil: 'domcontentloaded' });
  const input = page.getByLabel('Policy number', { exact: true });
  await expect(input).toHaveAttribute('placeholder', 'Number or code');
  expect(await input.evaluate((element) => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    context.font = style.font;
    return context.measureText(element.placeholder).width <= element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  })).toBe(true);
});
