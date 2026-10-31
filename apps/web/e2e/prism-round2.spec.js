import { test, expect } from 'playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('contact blocks malformed email and unchecked consent on the client', async ({ page }) => {
  let submissions = 0;
  await page.route('**/contact', async route => {
    if (route.request().method() === 'POST') { submissions++; await route.abort(); }
    else await route.continue();
  });
  await page.goto('/contact');
  await page.getByLabel('Your name', { exact: true }).fill('Test Person');
  await page.getByLabel('Email', { exact: true }).fill('x');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('[name="email"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[name="consent"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Please enter a valid email address.');
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('[name="consent"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[name="email"]')).toHaveAttribute('aria-invalid', 'false');
  expect(submissions).toBe(0);
});

for (const manual of [false, true]) {
  test(`quiz visits all eight questions (${manual ? 'Continue during auto advance' : 'automatic'})`, async ({ page }) => {
    await page.goto('/get-started');
    const counter = page.locator('p[aria-live="polite"]');
    await expect(counter).toHaveText('Question 1 of 8');
    await page.getByRole('button', { name: 'Just me', exact: true }).click();
    if (manual) await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(counter).toHaveText('Question 2 of 8');
    await page.getByRole('button', { name: 'Employed', exact: true }).click();
    if (manual) await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(counter).toHaveText('Question 3 of 8');
    await page.waitForTimeout(500); // A stale auto-advance must not skip the assets question.
    await expect(counter).toHaveText('Question 3 of 8');
    await expect(page.getByRole('heading', { name: "What do you own or use that you'd struggle to replace?" })).toBeVisible();
    for (let number = 4; number <= 8; number++) {
      await page.getByRole('button', { name: 'Skip this question' }).click();
      await expect(counter).toHaveText(`Question ${number} of 8`);
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(counter).toHaveText('Question 7 of 8');
  });
}

test('verify shows associated errors for empty, invalid and rejected input', async ({ page }) => {
  await page.route('**/api/public/verify-policy', route => route.fulfill({ status: 400, json: { valid: false, message: 'Please check the policy number.' } }));
  await page.goto('/verify');
  const input = page.getByLabel('Policy number', { exact: true });
  const submit = page.getByRole('button', { name: 'Verify', exact: true });
  await submit.click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Please enter the policy number.');
  await expect(input).toBeFocused();
  await input.fill('x');
  await submit.click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('at least 3 characters');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('BAD-123');
  await submit.click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Please check the policy number.');
  await expect(input).toBeFocused();
  await expect(page.locator(`[id="${await input.getAttribute('aria-describedby')}"]`)).toBeVisible();
});
