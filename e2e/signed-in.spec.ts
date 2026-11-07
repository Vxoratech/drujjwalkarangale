import { expect, test, type Page } from '@playwright/test';

/**
 * Signed-in screens against a simulated backend: the session is injected and
 * every API call is answered locally, so no real data is touched. Catches
 * layout bugs that unit tests can't see (e.g. a backdrop covering a drawer).
 */
const UID = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp: 4102444800 })}.sig`;
const PERMISSIONS = ['patients.view_basic', 'patients.create', 'patients.edit_contact', 'patients.edit', 'appointments.view', 'appointments.create', 'staff.view', 'staff.manage', 'staff.permissions'];

const DOCTOR_PERMISSIONS = [...PERMISSIONS, 'consultations.view', 'consultations.create', 'consultations.edit', 'examinations.view', 'examinations.edit', 'prescriptions.view', 'prescriptions.create', 'prescriptions.finalize', 'patients.view_history', 'investigations.view', 'investigations.order', 'investigations.upload', 'documents.view'];
const PATIENT = { id: '44444444-4444-4444-8444-444444444444', patient_code: 'P-000001', first_name: 'Asha', last_name: 'Patil', date_of_birth: '1985-04-12', approx_age_years: null, gender: 'female', phone: null, email: null, address_line: null, city: 'Pune', occupation: null, emergency_contact_name: null, emergency_contact_phone: null, preferred_locale: 'en', registered_branch_id: BRANCH, registered_on: '2026-11-01', status: 'active', duplicate_reviewed: false, created_at: '2026-11-01T05:00:00Z' };

async function signInAsAdmin(page: Page, calls: string[], account: 'admin' | 'primary_doctor' = 'admin') {
  await page.route('http://127.0.0.1:59999/**', async (route) => {
    const url = new URL(route.request().url());
    calls.push(url.pathname);
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'content-range': '0-0/0' } });
    switch (url.pathname) {
      case '/auth/v1/user':
        return json({ id: UID, email: 'admin@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {} });
      case '/rest/v1/rpc/my_access':
        return json({ account_type: account, user_id: UID, full_name: account === 'admin' ? 'Test Admin' : 'Dr. Test', email: 'admin@example.test', staff_id: null, designation: null, designation_label: null, permissions: account === 'admin' ? PERMISSIONS : DOCTOR_PERMISSIONS, all_branches: true, branches: [{ id: BRANCH, code: 'MAIN', name: 'Main Clinic', is_primary: true }] });
      case '/rest/v1/organization':
        return json({ id: 'o1', name: 'Test Clinic', legal_name: null, phone: null, email: null, address_line: null, city: null, state: null, pincode: null, gstin: null, registration_no: null, logo_path: null, primary_doctor_id: null });
      case '/rest/v1/clinic_settings':
        return json({ organization_id: 'o1', timezone: 'Asia/Kolkata', currency: 'INR', default_locale: 'en', invoice_prefix: 'INV', consultation_fee_paise: 0, brand_accent: null, prescription_footer: null, audit_retention_days: 2920, preferences: {} });
      case '/rest/v1/rpc/register_patient':
        return json({ id: '33333333-3333-4333-8333-333333333333', patient_code: 'P-000001', first_name: 'Asha', last_name: '' });
      case '/rest/v1/patients':
        // .single() asks for one object
        return json(route.request().headers()['accept']?.includes('vnd.pgrst.object') ? PATIENT : [PATIENT]);
      default:
        return json(url.pathname.startsWith('/rest/v1/') ? [] : {});
    }
  });
  await page.addInitScript(([token, uid]) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, email: 'admin@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} } }));
  }, [TOKEN, UID]);
}

test('the Register patient drawer is usable and submits', async ({ page }) => {
  const calls: string[] = [];
  await signInAsAdmin(page, calls);
  await page.goto('/patients');
  await page.getByRole('button', { name: 'Register patient' }).first().click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel(/^First name/).fill('Asha');
  // Fails if the backdrop sits above the drawer and swallows the click.
  await drawer.getByRole('button', { name: 'Register patient' }).click({ timeout: 5000 });
  await expect(page.getByText('Patient registered.')).toBeVisible();
  expect(calls).toContain('/rest/v1/rpc/find_possible_duplicates');
  expect(calls).toContain('/rest/v1/rpc/register_patient');
});

test('the Add staff drawer is usable', async ({ page }) => {
  await signInAsAdmin(page, []);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add staff' }).first().click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel(/^Full name/).fill('Priya Sharma');
  await drawer.getByRole('button', { name: 'Next' }).click({ timeout: 5000 });
  await expect(drawer.getByText('Enter a valid email address.')).toBeVisible();
});

test('the consultation header and side column stay in view while the record scrolls', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'Sticky side column applies to wide screens');
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsAdmin(page, [], 'primary_doctor');
  await page.goto(`/consultations/new?patient=${PATIENT.id}`);
  const save = page.getByRole('button', { name: 'Save draft' });
  const previous = page.getByRole('heading', { name: 'Previous visits' });
  await expect(save).toBeVisible();
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  await expect(save).toBeInViewport();
  await expect(previous).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('consultation-scrolled.png') });
});
