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
