import { expect, test } from '@playwright/test';

/**
 * Critical clinical flow against a DISPOSABLE test project seeded with
 * `npm run seed:demo`. Skipped unless these are set:
 *   E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_EMAIL (an admin+doctor), E2E_PASSWORD
 * Never point this at a project with real patients: it creates records.
 */
const live = Boolean(process.env.E2E_SUPABASE_URL && process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

test.describe('clinic flow (live backend)', () => {
  test.skip(!live, 'Set E2E_* variables to run against a disposable Supabase test project');
  test.describe.configure({ mode: 'serial' });

  test('register → consult → examine → prescribe → issue → print', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Run the full flow once, on desktop');
    const name = `E2E ${Date.now().toString(36)}`;

    await page.goto('/auth/sign-in');
    await page.getByLabel(/Email address/).fill(process.env.E2E_EMAIL!);
    await page.getByLabel(/^Password/).fill(process.env.E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();

    // Register a patient
    await page.getByRole('link', { name: 'Patients' }).first().click();
    await page.getByRole('button', { name: 'Register patient' }).first().click();
    await page.getByLabel(/^First name/).fill(name);
    await page.getByLabel(/Mobile number/).fill('+91 90000 00000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();

    // Consultation with Ayurvedic examination, then finalize
    await page.getByRole('link', { name: 'New consultation' }).click();
    await page.getByLabel(/Chief complaint/).fill('E2E: knee pain');
    await page.getByLabel(/Nadi/).first().fill('Vata-predominant');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Finalize consultation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Finalize consultation' }).click();
    await expect(page.getByText('Consultation finalized.')).toBeVisible();

    // Prescription: create, review, issue
    await page.getByRole('link', { name: 'Write prescription' }).click();
    await page.getByLabel(/^Medicine/).fill('Yogaraj Guggulu');
    await page.getByLabel(/^Dose/).fill('2 tablets');
    await page.getByLabel(/^Frequency/).fill('Twice daily');
    await page.getByRole('button', { name: 'Issue prescription' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: /I have reviewed/ }).check();
    await dialog.getByRole('button', { name: 'Issue prescription' }).click();
    await expect(page.getByRole('heading', { name: /RX-\d{4}-\d{6}/ })).toBeVisible();

    // Print view opens in a new tab
    const [print] = await Promise.all([page.waitForEvent('popup'), page.getByRole('link', { name: 'Print' }).click()]);
    await expect(print.getByText('Yogaraj Guggulu')).toBeVisible();
  });
});
