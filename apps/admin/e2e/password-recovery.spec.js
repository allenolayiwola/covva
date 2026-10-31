import { test, expect } from 'playwright/test';

for (const status of [200, 400]) {
  test(`password request has a generic response (${status})`, async ({ page }) => {
    await page.route('**/auth/v1/recover*', async route => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('redirect_to')).toBe(`${new URL(page.url()).origin}/reset-password`);
      expect(route.request().postDataJSON().email).toBe('staff@example.test');
      await route.fulfill({ status, contentType: 'application/json', body: status === 200 ? '{}' : '{"message":"Account not found"}' });
    });
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel('Work email').fill('staff@example.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('If an account matches that email, you will receive a password reset link.')).toBeVisible();
    await expect(page.getByText('Account not found')).toHaveCount(0);
  });
}

test('invalid recovery link offers another request', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.getByText(/This reset link is invalid or expired/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update password' })).toHaveCount(0);
});
