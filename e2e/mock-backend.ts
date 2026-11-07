import type { Page } from '@playwright/test';

/**
 * A simulated Supabase backend for signed-in browser tests: the session is
 * injected and every API call is answered locally with fictional data, so no
 * real data is touched. The playwright config points the app at 127.0.0.1:59999.
 */
export const UID = '11111111-1111-4111-8111-111111111111';
export const MAIN = '22222222-2222-4222-8222-222222222222';
export const DHANORI = '22222222-2222-4222-8222-222222222223';
export const PATIENT_ID = '44444444-4444-4444-8444-444444444444';

const ADMIN_PERMISSIONS = [
  'patients.view_basic', 'patients.view_history', 'patients.create', 'patients.edit_contact', 'patients.edit', 'patients.delete', 'patients.export',
  'consents.manage', 'appointments.view', 'appointments.create', 'appointments.reschedule', 'appointments.cancel', 'appointments.update_status',
  'consultations.view', 'examinations.view', 'prescriptions.view', 'prescriptions.print', 'investigations.view', 'investigations.upload', 'investigations.manage',
  'documents.view', 'documents.delete', 'follow_ups.view', 'follow_ups.manage', 'billing.view', 'billing.create', 'billing.void', 'billing.export',
  'payments.record', 'payments.refund', 'payments.reconcile', 'reports.operational', 'reports.financial', 'reports.clinical',
  'staff.view', 'staff.manage', 'staff.permissions', 'branches.manage', 'settings.branch', 'settings.organization', 'audit.view',
];
const DOCTOR_ONLY = ['consultations.create', 'consultations.edit', 'examinations.edit', 'prescriptions.create', 'prescriptions.finalize', 'investigations.order'];
const DOCTOR_PERMISSIONS = [
  ...ADMIN_PERMISSIONS.filter((k) => !['settings.organization', 'billing.create', 'billing.void', 'billing.export', 'payments.record', 'payments.refund', 'payments.reconcile', 'reports.financial'].includes(k)),
  ...DOCTOR_ONLY,
];

const branches = [
  { id: MAIN, code: 'MAIN', name: 'Main Clinic', address_line: '12 Shanti Nagar, Kothrud', city: 'Pune', state: 'Maharashtra', pincode: '411038', phone: '+91 20 4000 1234', email: null, is_primary: true, is_active: true, manager_staff_id: null },
  { id: DHANORI, code: 'DHN', name: 'Dhanori Branch', address_line: 'Lohegaon Road', city: 'Pune', state: 'Maharashtra', pincode: '411015', phone: '+91 20 4000 2222', email: null, is_primary: false, is_active: true, manager_staff_id: null },
];
const patient = {
  id: PATIENT_ID, patient_code: 'P-000001', first_name: 'Asha', last_name: 'Patil', date_of_birth: '1985-04-12', approx_age_years: null, gender: 'female',
  phone: '+91 98220 10001', email: null, address_line: 'Flat 4, Sai Residency', city: 'Pune', occupation: 'Teacher', emergency_contact_name: null,
  emergency_contact_phone: null, preferred_locale: 'en', registered_branch_id: MAIN, registered_on: '2026-11-01', status: 'active', duplicate_reviewed: false,
  created_at: '2026-11-01T05:00:00Z',
};
const patients = [
  patient,
  { ...patient, id: '44444444-4444-4444-8444-444444444445', patient_code: 'P-000002', first_name: 'Ganesh', last_name: 'More', gender: 'male', date_of_birth: '1965-09-30', phone: '+91 98220 10002', registered_branch_id: DHANORI },
  { ...patient, id: '44444444-4444-4444-8444-444444444446', patient_code: 'P-000003', first_name: 'Lata', last_name: 'Shinde', date_of_birth: null, approx_age_years: 72, phone: null },
];
const today = new Date();
const at = (h: number, m: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h - 5, m - 30)).toISOString();
const appointments = [
  { id: 'a1', branch_id: MAIN, patient_id: PATIENT_ID, starts_at: at(10, 0), ends_at: at(10, 30), type: 'follow_up', status: 'checked_in', reason: 'Knee pain review', source: 'follow_up', notes: null, cancellation_reason: null, cancelled_at: null, patient: { id: PATIENT_ID, first_name: 'Asha', last_name: 'Patil', patient_code: 'P-000001', phone: '+91 98220 10001' } },
  { id: 'a2', branch_id: DHANORI, patient_id: patients[1]!.id, starts_at: at(16, 0), ends_at: at(16, 30), type: 'new_visit', status: 'scheduled', reason: 'Acidity', source: 'phone', notes: null, cancellation_reason: null, cancelled_at: null, patient: { id: patients[1]!.id, first_name: 'Ganesh', last_name: 'More', patient_code: 'P-000002', phone: '+91 98220 10002' } },
];
const staff = [
  { id: 's1', user_id: 'u-s1', full_name: 'Priya Sharma', email: 'priya@demo.vaidyora.test', mobile: '+91 90000 00001', designation: 'receptionist', designation_label: null, role_id: 'r-rec', employee_code: 'E-001', employment_type: 'full_time', joined_on: '2026-10-01', status: 'active', invited_at: '2026-10-01T05:00:00Z', accepted_at: '2026-10-01T06:00:00Z', deactivated_at: null, deactivation_reason: null, created_at: '2026-10-01T05:00:00Z', assignments: [{ branch_id: MAIN }, { branch_id: DHANORI }] },
  { id: 's2', user_id: null, full_name: 'Kiran Patil', email: 'kiran@demo.vaidyora.test', mobile: null, designation: 'accountant', designation_label: null, role_id: 'r-acc', employee_code: null, employment_type: 'part_time', joined_on: null, status: 'invited', invited_at: null, accepted_at: null, deactivated_at: null, deactivation_reason: null, created_at: '2026-11-02T05:00:00Z', assignments: [{ branch_id: MAIN }] },
];
const catalog = [
  ['patients.view_basic', 'View basic patient information', 'normal', false], ['patients.view_history', 'View medical history', 'clinical', false], ['patients.create', 'Register new patients', 'normal', false],
  ['appointments.view', 'View appointments', 'normal', false], ['appointments.cancel', 'Cancel appointments', 'normal', false], ['consultations.view', 'View consultations', 'clinical', false],
  ['consultations.edit', 'Edit and finalize consultations', 'clinical', true], ['billing.view', 'View invoices', 'normal', false], ['staff.manage', 'Manage staff', 'sensitive', false], ['audit.view', 'View audit logs', 'sensitive', false],
].map(([key, label, sensitivity, doctor_only], i) => ({ key, module: String(key).split('.')[0], action: String(key).split('.')[1], label, description: `${label}.`, sensitivity, doctor_only, position: i }));
const roles = [
  { id: 'r-doc', key: 'primary_doctor', name: 'Primary doctor', description: 'Dr. Ujjwal Karangale', scope: 'account', is_system: true, default_designation: null, role_permissions: catalog.map((p) => ({ permission_key: p.key })) },
  { id: 'r-rec', key: 'receptionist', name: 'Receptionist', description: 'Front desk: registration, appointments and consents', scope: 'staff', is_system: true, default_designation: 'receptionist', role_permissions: [{ permission_key: 'patients.view_basic' }, { permission_key: 'patients.create' }, { permission_key: 'appointments.view' }, { permission_key: 'appointments.cancel' }] },
  { id: 'r-acc', key: 'accountant', name: 'Accountant', description: 'Billing and payments', scope: 'staff', is_system: true, default_designation: 'accountant', role_permissions: [{ permission_key: 'billing.view' }] },
];
const invoices = [
  { id: 'i1', branch_id: MAIN, patient_id: PATIENT_ID, appointment_id: null, invoice_no: 'INV-2026-000001', status: 'partially_paid', issue_date: '2026-11-05', subtotal_paise: 190000, tax_paise: 0, discount_paise: 0, total_paise: 190000, amount_paid_paise: 100000, amount_refunded_paise: 0, notes: null, void_reason: null, created_at: '2026-11-05T05:00:00Z', patient: { id: PATIENT_ID, first_name: 'Asha', last_name: 'Patil', patient_code: 'P-000001', phone: null } },
];

export async function signIn(page: Page, account: 'admin' | 'primary_doctor' = 'admin', calls: string[] = []) {
  await page.route('http://127.0.0.1:59999/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    calls.push(p);
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single && Array.isArray(body) ? body[0] ?? null : body), headers: { 'content-range': `0-${Array.isArray(body) ? Math.max(body.length - 1, 0) : 0}/${Array.isArray(body) ? body.length : 1}` } });
    const table: Record<string, unknown> = {
      '/auth/v1/user': { id: UID, email: 'user@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {} },
      '/rest/v1/rpc/my_access': {
        account_type: account, user_id: UID, full_name: account === 'admin' ? 'Snehal Gaikwad' : 'Dr. Ujjwal Karangale', email: 'user@example.test', staff_id: null, designation: null, designation_label: null,
        permissions: account === 'admin' ? ADMIN_PERMISSIONS : DOCTOR_PERMISSIONS, all_branches: true, branches: branches.map(({ id, code, name, is_primary }) => ({ id, code, name, is_primary })),
      },
      '/rest/v1/organization': [{ id: 'o1', name: 'Dr. Ujjwal Karangale Ayurvedic Clinic', legal_name: null, phone: '+91 20 4000 1234', email: null, address_line: '12 Shanti Nagar', city: 'Pune', state: 'Maharashtra', pincode: '411038', gstin: null, registration_no: null, logo_path: null, primary_doctor_id: UID }],
      '/rest/v1/clinic_settings': [{ organization_id: 'o1', timezone: 'Asia/Kolkata', currency: 'INR', default_locale: 'en', invoice_prefix: 'INV', consultation_fee_paise: 50000, brand_accent: null, prescription_footer: null, audit_retention_days: 2920, preferences: {} }],
      '/rest/v1/clinic_branches': branches,
      '/rest/v1/patients': single ? patient : patients,
      '/rest/v1/rpc/view_patient': patient,
      '/rest/v1/patient_medical_profiles': [{ patient_id: PATIENT_ID, blood_group: 'B+', allergies: 'Sulpha drugs', chronic_conditions: 'Osteoarthritis (knees)', prakriti: 'vata_pitta' }],
      '/rest/v1/appointments': appointments,
      '/rest/v1/staff_members': single ? staff[0] : staff,
      '/rest/v1/roles': roles,
      '/rest/v1/permissions': catalog,
      '/rest/v1/user_profiles': [],
      '/rest/v1/invoices': single ? { ...invoices[0], items: [], payments: [], refunds: [] } : invoices,
      '/rest/v1/rpc/org_overview': { patients_total: 128, patients_new: 14, branches_active: 2, appointments_today: 9, appointments_remaining_today: 5, appointments_in_range: 212, appointments_no_show: 6, consultations_completed: 174, consultations_open: 2, follow_ups_pending: 11, follow_ups_overdue: 3, collected_paise: 18650000, refunded_paise: 50000, outstanding_paise: 920000, outstanding_invoices: 7, unreconciled_payments: 4 },
      '/rest/v1/rpc/branch_metrics': branches.map((b, i) => ({ branch_id: b.id, branch_name: b.name, is_active: true, patients_registered: 10 - i * 4, appointments: 140 - i * 60, appointments_completed: 120 - i * 50, no_shows: 4 - i, consultations_completed: 118 - i * 50, invoiced_paise: 15000000 - i * 6000000, collected_paise: 13000000 - i * 5000000, outstanding_paise: 600000 - i * 200000 })),
      '/rest/v1/rpc/doctor_overview': { appointments_today: 9, waiting: 2, in_progress: 1, completed_today: 3, completed_this_month: 61, follow_ups_due: 5, pending_prescriptions: 1, pending_results: 2, next_patient: { appointment_id: 'a1', patient_id: PATIENT_ID, patient_code: 'P-000001', first_name: 'Asha', last_name: 'Patil', starts_at: at(10, 0), status: 'checked_in', branch_id: MAIN, branch_name: 'Main Clinic', type: 'follow_up', reason: 'Knee pain review' }, branch_schedule: [{ branch_id: MAIN, branch_name: 'Main Clinic', appointments: 6, remaining: 3, first_at: at(9, 30) }, { branch_id: DHANORI, branch_name: 'Dhanori Branch', appointments: 3, remaining: 2, first_at: at(16, 0) }] },
      '/rest/v1/rpc/clinical_report': { consultations_finalized: 61, new_patients_seen: 9, prescriptions_issued: 58, prescriptions_revised: 2, investigations_ordered: 12, investigations_resulted: 9, follow_ups_created: 20, by_branch: [] },
      '/rest/v1/rpc/staff_activity': staff.map((s, i) => ({ staff_id: s.id, full_name: s.full_name, designation: s.designation, status: s.status, event_count: 40 - i * 30, last_activity_at: '2026-11-06T10:00:00Z' })),
      '/rest/v1/rpc/staff_last_activity': [{ staff_id: 's1', last_activity_at: '2026-11-06T10:00:00Z', last_sign_in_at: null }],
      '/rest/v1/rpc/staff_permission_matrix': catalog.map((c) => ({ permission_key: c.key, in_template: ['patients.view_basic', 'patients.create', 'appointments.view', 'appointments.cancel'].includes(String(c.key)), override: c.key === 'billing.view' ? 'grant' : null, effective: true, grantable: !c.doctor_only })),
      '/rest/v1/rpc/register_patient': patient,
      '/rest/v1/rpc/find_possible_duplicates': [],
    };
    if (p in table) return json(table[p]);
    if (p.startsWith('/rest/v1/rpc/clinic_trends')) return json([]);
    return json(p.startsWith('/rest/v1/') ? [] : {});
  });
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp: 4102444800 })}.sig`;
  await page.addInitScript(([t, uid]) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: t, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, email: 'user@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} } }));
  }, [token, UID]);
}
