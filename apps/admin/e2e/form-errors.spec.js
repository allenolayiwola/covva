import { test, expect } from 'playwright/test';
import { showFieldErrors } from '../src/lib/field-errors';

test('server field errors sit beside controls, preserve hints and clear on the next result', async ({ page }) => {
  await page.setContent('<form><label for="value">Value</label><textarea id="value" name="value" aria-describedby="hint"></textarea><p id="hint">Enter JSON</p><input name="key" type="hidden"></form>');
  await page.addScriptTag({ content: `window.showFieldErrors = ${showFieldErrors.toString()}` });
  await page.evaluate(() => {
    window.clearErrors = window.showFieldErrors(document.querySelector('form'), { 'value.limit': ['Must be positive'], 'value.currency': ['Use GHS'], key: ['Invalid key'] }, 'errors');
  });
  await expect(page.getByLabel('Value')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Value')).toHaveAttribute('aria-describedby', 'hint errors-value.limit errors-value.currency');
  await expect(page.locator('textarea + p')).toHaveText('Use GHS');
  await expect(page.getByText('Must be positive')).toBeVisible();
  await page.evaluate(() => window.clearErrors());
  await expect(page.getByLabel('Value')).not.toHaveAttribute('aria-invalid');
  await expect(page.getByLabel('Value')).toHaveAttribute('aria-describedby', 'hint');
  await expect(page.getByText('Must be positive')).toHaveCount(0);
});
