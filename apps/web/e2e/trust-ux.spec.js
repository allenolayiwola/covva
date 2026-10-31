import { test, expect } from 'playwright/test';

for (const width of [360, 390, 1280]) {
  test(`trust and phone controls at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#trust-bar-title')).toHaveCount(0);
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
    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
    const email = page.getByRole('tab', { name: 'Email link' });
    const phone = page.getByRole('tab', { name: 'Phone code' });
    for (const tab of [email, phone]) {
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
    await email.click();
    await expect(email).toHaveAttribute('aria-selected', 'true');
    await phone.click();
    await expect(phone).toHaveAttribute('aria-selected', 'true');
    await info.attach(`sign-in-${width}`, { body: await page.screenshot({ caret: "initial" }), contentType: 'image/png' });
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
