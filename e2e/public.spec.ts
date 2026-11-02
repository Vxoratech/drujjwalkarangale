import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

test.describe('sign-in', () => {
  test('validates input and moves focus to the first invalid field', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByRole('heading', { name: 'Sign in to your clinic' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByText('This field is required.')).toBeVisible();
    await expect(page.getByLabel(/Email address/)).toBeFocused();
    await expectNoHorizontalOverflow(page);
  });

  test('password visibility toggle is keyboard accessible', async ({ page }) => {
    await page.goto('/auth/sign-in');
    const password = page.getByLabel(/^Password/);
    await password.fill('Secret123!');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).press('Enter');
    await expect(password).toHaveAttribute('type', 'text');
  });
});

test.describe('Marathi', () => {
  test('switches the UI to Marathi and renders Devanagari with a capable font', async ({ page }) => {
    await page.goto('/auth/sign-in');
    await page.getByRole('button', { name: 'मराठी' }).click();
    const heading = page.getByRole('heading', { name: 'आपल्या क्लिनिकमध्ये साइन इन करा' });
    await expect(heading).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'mr');
    const fontFamily = await heading.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain('Noto Sans Devanagari');
    // The Devanagari font must actually be loaded (no tofu boxes).
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      await document.fonts.load('16px "Noto Sans Devanagari"', 'अ');
      return document.fonts.check('16px "Noto Sans Devanagari"', 'अ');
    });
    expect(loaded).toBe(true);
    // Validation messages are translated too.
    await page.getByRole('button', { name: 'साइन इन' }).click();
    await expect(page.getByText('हे क्षेत्र आवश्यक आहे.')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('the choice persists across reloads', async ({ page }) => {
    await page.goto('/auth/sign-in');
    await page.getByRole('button', { name: 'मराठी' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'साइन इन' })).toBeVisible();
  });
});

test.describe('responsive layouts', () => {
  for (const path of ['/auth/sign-in', '/auth/forgot', '/__gallery', '/__fixtures/prescription']) {
    test(`no horizontal scrolling on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page);
    });
  }

  test('data tables become cards on small screens', async ({ page, isMobile }) => {
    await page.goto('/__gallery');
    // exact: the gallery's "New patients" chart is also a list.
    const table = page.getByRole('table', { name: 'Patients', exact: true });
    if (isMobile) {
      await expect(table).toBeHidden();
      await expect(page.getByRole('list', { name: 'Patients', exact: true })).toBeVisible();
    } else {
      await expect(table).toBeVisible();
    }
  });
});
