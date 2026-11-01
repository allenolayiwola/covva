import { test, expect } from 'playwright/test';

// Sign-in tabs fit phone widths (moved from the marketing site's trust-ux spec when sign-in moved to the app).
for (const width of [360, 390, 1280]) {
  test(`sign-in controls at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
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
