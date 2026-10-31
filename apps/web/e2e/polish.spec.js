import { test, expect } from 'playwright/test';
import { ACCOUNTS, PASSWORD } from './support/env.js';

test.describe('public error and sign-in polish', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const [path, context] of [['/account', 'Sign in to view your account'], ['/partner/register', 'Sign in to register as a partner']]) {
    test(`sign-in preserves ${path} and explains why`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp('/sign-in\\?next='));
      await expect(page.getByText(context, { exact: true })).toBeVisible();
      await expect(page.locator('main form')).toHaveCount(1);
      await page.getByRole('button', { name: 'Use a password instead' }).click();
      await expect(page.locator('main form')).toHaveCount(1);
      await expect(page.locator('input[name="next"]')).toHaveValue(path);
    });
  }
  test('requested password mode never renders a second sign-in form', async ({ page, request }) => {
    const response = await request.get('/sign-in?method=password&next=%2Fpartner%2Fregister');
    // Check the full streamed response too: a working fallback form can flash before hydration.
    expect((await response.text()).match(/<form(?:\s|>)/g)).toHaveLength(1);
    await page.goto('/sign-in?method=password&next=%2Fpartner%2Fregister', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.locator('main form')).toHaveCount(1);
  });
  test('external next is rejected', async ({ page }) => {
    await page.goto('/sign-in?method=password&next=https%3A%2F%2Fevil.example', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('input[name="next"]')).toHaveValue('/account');
  });
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

test('quote vehicle value is an example, starts empty and is required', async ({ page }) => {
  await page.goto('/quote?category=motor', { waitUntil: 'domcontentloaded' });
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  // Advance through the optional registration and standard catalogue questions.
  await expect(page.locator('#q-registration_number, #q-vehicle_value')).toBeVisible();
  if (await page.locator('#q-registration_number').isVisible()) await next.click();
  if (await page.getByRole('radio', { name: 'Comprehensive', exact: true }).count()) {
    await page.getByRole('radio', { name: 'Comprehensive', exact: true }).check();
    await next.click();
  }
  if (await page.getByLabel('Vehicle make', { exact: true }).count()) {
    await page.getByLabel('Vehicle make', { exact: true }).fill('Toyota');
    await page.getByLabel('Model', { exact: true }).fill('Corolla');
    await next.click();
  }
  if (await page.getByLabel('Year of manufacture', { exact: true }).count()) await page.getByLabel('Year of manufacture', { exact: true }).fill('2020');
  const value = page.locator('#q-vehicle_value');
  await expect(value).toHaveValue('');
  await expect(value).toHaveAttribute('placeholder', /\d/);
  await next.click();
  await expect(value).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('This is needed for a quote', { exact: true })).toBeVisible();
  await value.fill('120000');
  await next.click();
  await expect(page.getByText('This is needed for a quote', { exact: true })).toHaveCount(0);
});

for (const destination of ['/account', '/partner/register']) {
  test(`successful sign-in returns to ${destination}`, async ({ page }) => {
    await page.goto(`/sign-in?method=password&next=${encodeURIComponent(destination)}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email address').fill(ACCOUNTS.customer);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
  });
}

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
