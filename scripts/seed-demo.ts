/**
 * Seeds fictional demo data into a LOCAL or STAGING Supabase project:
 * the primary doctor, an administrator, a second branch, three staff members,
 * patients, appointments, a finalized consultation and bills.
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   DEMO_PASSWORD='choose-a-strong-one' npm run seed:demo
 *
 * Every person and number here is invented (.test addresses). The service-role
 * key is read from the shell only. Refuses hosted projects unless
 * ALLOW_REMOTE_SEED=yes (use that only for a disposable staging project).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD;

if (!url || !anonKey || !serviceKey || !password) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and DEMO_PASSWORD.');
  process.exit(1);
}
if (/supabase\.co/.test(url) && process.env.ALLOW_REMOTE_SEED !== 'yes') {
  console.error('Refusing to seed a hosted project. Set ALLOW_REMOTE_SEED=yes for a disposable staging project.');
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } });

async function demoUser(email: string, fullName: string): Promise<string> {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (created.data.user) return created.data.user.id;
  const { data } = await service.rpc('find_user_id_by_email', { p_email: email });
  if (!data) throw new Error(`Could not create ${email}: ${created.error?.message}`);
  return data as string;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: password! });
  if (error) throw error;
  return client;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? 'no data'}`);
  return res.data;
}

/** ISO timestamp for today (Asia/Kolkata) at hh:mm, offset by `days`. */
function istAt(days: number, hh: number, mm: number): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, hh, mm) - 330 * 60_000).toISOString();
}

async function staff(by: SupabaseClient, email: string, fullName: string, role: string, branches: string[], designation = role): Promise<void> {
  const roleId = must(await by.from('roles').select('id').eq('key', role).single(), `role ${role}`).id as string;
  const row = must(
    await by.rpc('create_staff_member', { p_profile: { full_name: fullName, email, designation }, p_role: roleId, p_branches: branches, p_overrides: {} }),
    `staff ${email}`,
  ) as { id: string };
  const userId = await demoUser(email, fullName);
  must(await service.rpc('link_staff_account', { p_staff: row.id, p_user: userId }).then((r) => ({ ...r, data: true })), `link ${email}`);
  const member = await signIn(email);
  must(await member.rpc('accept_staff_invitation').then((r) => ({ ...r, data: true })), `accept ${email}`);
}

async function main(): Promise<void> {
  // Identities (the doctor binding is the same call as scripts/bootstrap.ts).
  await demoUser('dr.ujjwal@demo.vaidyora.test', 'Dr. Ujjwal Karangale');
  const { data: org } = await service.from('organization').select('primary_doctor_id').single();
  if (!org?.primary_doctor_id) must(await service.rpc('bootstrap_primary_doctor', { p_email: 'dr.ujjwal@demo.vaidyora.test' }), 'bind doctor');
  const adminId = await demoUser('admin@demo.vaidyora.test', 'Snehal Gaikwad');
  must(await service.rpc('link_admin_account', { p_user: adminId }).then((r) => ({ ...r, data: true })), 'admin');

  await service.from('clinic_settings').update({ preferences: { demo: true, bilingual_labels: true, default_appointment_minutes: 30, prescription_language: 'patient' }, consultation_fee_paise: 50000, invoice_prefix: 'KAC' }).neq('organization_id', '00000000-0000-0000-0000-000000000000');

  const doctor = await signIn('dr.ujjwal@demo.vaidyora.test');
  const adminClient = await signIn('admin@demo.vaidyora.test');
  await doctor.from('user_profiles').update({ qualification: 'BAMS, MD (Kayachikitsa)', medical_registration_no: 'I-00000-A (Demo)' }).neq('id', '00000000-0000-0000-0000-000000000000');

  const main = must(await adminClient.from('clinic_branches').select('id').eq('code', 'MAIN').single(), 'main branch').id as string;
  const dhanori = must(
    await adminClient.from('clinic_branches').insert({ code: 'DHN', name: 'Dhanori Branch', city: 'Pune', phone: '+91 20 4000 2222' }).select('id').single(),
    'branch',
  ).id as string;

  await staff(adminClient, 'priya@demo.vaidyora.test', 'Priya Sharma', 'receptionist', [main, dhanori]);
  await staff(adminClient, 'kiran@demo.vaidyora.test', 'Kiran Patil', 'accountant', [main]);
  await staff(doctor, 'meena@demo.vaidyora.test', 'Meena Jadhav', 'branch_manager', [dhanori]);

  const reception = await signIn('priya@demo.vaidyora.test');
  const register = async (branch: string, p: Record<string, unknown>) =>
    must(await reception.rpc('register_patient', { p_patient: p, p_branch: branch, p_duplicate_reviewed: true }), 'patient') as { id: string };
  const p1 = await register(main, { first_name: 'Sunita', last_name: 'Pawar', gender: 'female', date_of_birth: '1978-04-12', phone: '+91 98220 10001', city: 'Pune' });
  const p2 = await register(main, { first_name: 'Ganesh', last_name: 'More', gender: 'male', date_of_birth: '1965-09-30', phone: '+91 98220 10002', city: 'Pimpri' });
  const p3 = await register(dhanori, { first_name: 'Ananya', last_name: 'Kulkarni', gender: 'female', date_of_birth: '1994-01-22', phone: '+91 98220 10003', city: 'Pune', preferred_locale: 'mr' });
  const p4 = await register(dhanori, { first_name: 'Lata', last_name: 'Shinde', gender: 'female', approx_age_years: 72, phone: '+91 98220 10005', city: 'Dhanori' });

  must(
    await reception.from('appointments').insert([
      { branch_id: main, patient_id: p1.id, starts_at: istAt(0, 10, 0), ends_at: istAt(0, 10, 30), type: 'follow_up', source: 'follow_up', reason: 'Knee pain review' },
      { branch_id: main, patient_id: p2.id, starts_at: istAt(0, 11, 0), ends_at: istAt(0, 11, 30), type: 'new_visit', reason: 'Weight management' },
      { branch_id: dhanori, patient_id: p3.id, starts_at: istAt(0, 16, 0), ends_at: istAt(0, 16, 30), type: 'new_visit', reason: 'Acidity, skin rash' },
      { branch_id: dhanori, patient_id: p4.id, starts_at: istAt(1, 17, 0), ends_at: istAt(1, 18, 0), type: 'panchakarma', reason: 'Abhyanga & swedana' },
    ]).select('id'),
    'appointments',
  );

  // A finalized past consultation with examination and an issued prescription.
  await doctor.rpc('save_medical_profile', { p_patient: p1.id, p_medical: { chronic_conditions: 'Osteoarthritis (knees)', prakriti: 'vata_pitta' } });
  const consultation = must(
    await doctor.rpc('save_consultation', {
      p_id: null,
      p_data: {
        patient_id: p1.id, branch_id: main,
        chief_complaint: 'Bilateral knee pain, worse in the morning, for 3 months',
        assessment: 'Degenerative joint changes with Vata predominance', pulse_bpm: 76, bp_systolic: 128, bp_diastolic: 82,
        diagnosis: 'Primary osteoarthritis, both knees', ayurvedic_diagnosis: 'Sandhigata Vata',
        treatment_plan: 'Shamana chikitsa for 30 days; Janu basti ×7 sittings.',
        pathya: 'Warm, freshly cooked food; sesame oil; gentle walking', apathya: 'Cold food, curd at night',
        follow_up_date: istAt(14, 12, 0).slice(0, 10),
      },
      p_exam: { prakriti: 'vata_pitta', vikriti: ['vata'], agni: 'vishama', koshtha: 'krura', bala: 'madhyama', nadi: 'Vata-predominant', vata_score: 7, pitta_score: 4, kapha_score: 2, ama: 'mild' },
    }),
    'consultation',
  ) as string;
  const rx = must(
    await doctor.rpc('save_prescription_draft', {
      p_id: null, p_patient: p1.id, p_consultation: consultation, p_header: { language: 'mr', patient_instructions: 'Avoid cold drinks.' },
      p_items: [
        { medicine_name: 'Yogaraj Guggulu', form: 'vati', dose: '2 tablets', frequency: 'Twice daily', timing: 'after_food', anupana: 'Warm water', instructions_mr: 'जेवणानंतर कोमट पाण्यासोबत', duration_days: 30 },
        { medicine_name: 'Mahanarayan Taila', form: 'taila', route: 'topical', dose: 'Local application', frequency: 'Once daily', timing: 'as_directed', duration_days: 30 },
      ],
    }),
    'prescription',
  ) as string;
  must(await doctor.rpc('issue_prescription', { p_prescription: rx, p_clinician_confirmed: true }), 'issue prescription');
  must(await doctor.rpc('finalize_consultation', { p_consultation: consultation }), 'finalize consultation');

  const accounts = await signIn('kiran@demo.vaidyora.test');
  const inv = must(
    await accounts.rpc('create_invoice', {
      p_patient: p1.id, p_branch: main, p_discount_paise: 0,
      p_items: [
        { description: 'Follow-up consultation', item_type: 'consultation', quantity: 1, unit_price_paise: 30000 },
        { description: 'Janu basti (per sitting)', item_type: 'panchakarma', quantity: 2, unit_price_paise: 80000 },
      ],
    }),
    'invoice',
  ) as { id: string; total_paise: number };
  must(await accounts.rpc('record_payment', { p_invoice: inv.id, p_amount_paise: inv.total_paise, p_method: 'upi', p_reference: 'DEMO-UPI-0001' }), 'payment');

  console.log('Seeded fictional demo data. Sign in as dr.ujjwal@, admin@, priya@, kiran@ or meena@demo.vaidyora.test (password from DEMO_PASSWORD).');
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
