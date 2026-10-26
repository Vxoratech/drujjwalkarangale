/**
 * Seeds a fictional demo clinic into a LOCAL or STAGING Supabase project.
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   DEMO_PASSWORD='choose-a-strong-one' npm run seed:demo
 *
 * The service-role key is read from the shell environment only — it must never
 * be placed in a VITE_* variable or committed. All names are fictional.
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
  console.error('Refusing to seed a hosted project. Set ALLOW_REMOTE_SEED=yes for a staging project.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function ensureUser(email: string, fullName: string): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.data.user) return created.data.user.id;
  const { data } = await admin.rpc('find_user_id_by_email', { p_email: email });
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
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, hh, mm) - 330 * 60_000);
  return d.toISOString();
}

async function main(): Promise<void> {
  const ownerId = await ensureUser('dr.ujjwal@demo.vaidyora.test', 'Dr. Ujjwal Karangale');
  const adminId = await ensureUser('admin@demo.vaidyora.test', 'Snehal Gaikwad');
  const doctorId = await ensureUser('dr.meera@demo.vaidyora.test', 'Dr. Meera Joshi');

  const owner = await signIn('dr.ujjwal@demo.vaidyora.test');
  const clinicId = must(
    await owner.rpc('create_clinic', { p_name: 'Karangale Ayurveda Clinic (Demo)', p_city: 'Pune', p_phone: '+91 20 4000 1234', p_is_practitioner: true }),
    'create clinic',
  ) as string;

  must(
    await admin.from('clinics').update({
      legal_name: 'Karangale Ayurveda Wellness LLP (Demo)',
      address_line: '12, Shanti Nagar, Kothrud',
      state: 'Maharashtra',
      pincode: '411038',
      email: 'clinic@demo.vaidyora.test',
      consultation_fee_paise: 50000,
      invoice_prefix: 'KAC',
    }).eq('id', clinicId).select().single(),
    'clinic profile',
  );
  must(
    await admin.from('clinic_members').insert([
      { clinic_id: clinicId, user_id: adminId, roles: ['admin'], invited_by: ownerId, accepted_at: new Date().toISOString() },
      { clinic_id: clinicId, user_id: doctorId, roles: ['doctor'], invited_by: ownerId, accepted_at: new Date().toISOString() },
    ]).select(),
    'members',
  );
  await admin.from('profiles').update({ qualification: 'BAMS, MD (Kayachikitsa)', medical_registration_no: 'I-00000-A (Demo)' }).eq('id', ownerId);
  await admin.from('profiles').update({ qualification: 'BAMS', medical_registration_no: 'I-00001-A (Demo)' }).eq('id', doctorId);

  const staff = await signIn('admin@demo.vaidyora.test');
  const patients = must(
    await staff.from('patients').insert([
      { clinic_id: clinicId, first_name: 'Sunita', last_name: 'Pawar', gender: 'female', date_of_birth: '1978-04-12', phone: '+91 98220 10001', city: 'Pune', prakriti: 'vata_pitta', assigned_doctor_id: ownerId, chronic_conditions: 'Osteoarthritis (knees)' },
      { clinic_id: clinicId, first_name: 'Ganesh', last_name: 'More', gender: 'male', date_of_birth: '1965-09-30', phone: '+91 98220 10002', city: 'Pimpri', prakriti: 'kapha', assigned_doctor_id: ownerId, allergies: 'Sulpha drugs' },
      { clinic_id: clinicId, first_name: 'Ananya', last_name: 'Kulkarni', gender: 'female', date_of_birth: '1994-01-22', phone: '+91 98220 10003', city: 'Pune', prakriti: 'pitta', assigned_doctor_id: doctorId, preferred_locale: 'mr' },
      { clinic_id: clinicId, first_name: 'Rahul', last_name: 'Deshmukh', gender: 'male', date_of_birth: '1988-07-05', phone: '+91 98220 10004', city: 'Hadapsar', assigned_doctor_id: doctorId },
      { clinic_id: clinicId, first_name: 'Lata', last_name: 'Shinde', gender: 'female', date_of_birth: '1952-11-18', phone: '+91 98220 10005', city: 'Pune', prakriti: 'vata', assigned_doctor_id: ownerId },
    ]).select('id, first_name, assigned_doctor_id'),
    'patients',
  );

  const [p1, p2, p3, p4, p5] = patients;
  must(
    await staff.from('appointments').insert([
      { clinic_id: clinicId, patient_id: p1!.id, doctor_id: ownerId, starts_at: istAt(0, 10, 0), ends_at: istAt(0, 10, 30), type: 'follow_up', source: 'follow_up', reason: 'Knee pain review' },
      { clinic_id: clinicId, patient_id: p2!.id, doctor_id: ownerId, starts_at: istAt(0, 11, 0), ends_at: istAt(0, 11, 30), type: 'new_visit', reason: 'Weight management' },
      { clinic_id: clinicId, patient_id: p5!.id, doctor_id: ownerId, starts_at: istAt(0, 16, 0), ends_at: istAt(0, 17, 0), type: 'panchakarma', reason: 'Abhyanga & swedana' },
      { clinic_id: clinicId, patient_id: p3!.id, doctor_id: doctorId, starts_at: istAt(0, 12, 0), ends_at: istAt(0, 12, 30), type: 'new_visit', reason: 'Acidity, skin rash' },
      { clinic_id: clinicId, patient_id: p4!.id, doctor_id: doctorId, starts_at: istAt(1, 10, 30), ends_at: istAt(1, 11, 0), type: 'teleconsultation', reason: 'Sleep disturbance' },
    ]).select('id'),
    'appointments',
  );

  // A finalized past consultation with examination and an issued prescription.
  const consult = must(
    await owner.from('consultations').insert({
      clinic_id: clinicId, patient_id: p1!.id, doctor_id: ownerId,
      chief_complaint: 'Bilateral knee pain, worse in the morning, for 3 months',
      assessment: 'Degenerative joint changes with Vata predominance',
      history_of_present_illness: 'Stiffness ~20 min after waking. Crepitus on movement. No swelling.',
      pulse_bpm: 76, bp_systolic: 128, bp_diastolic: 82, weight_kg: 68, height_cm: 158,
      diagnosis: 'Primary osteoarthritis, both knees', ayurvedic_diagnosis: 'Sandhigata Vata',
      treatment_plan: 'Shamana chikitsa for 30 days; Janu basti ×7 sittings.',
      pathya: 'Warm, freshly cooked food; sesame oil; gentle walking', apathya: 'Cold food, curd at night, prolonged fasting',
      follow_up_date: istAt(3, 12, 0).slice(0, 10),
    }).select('id').single(),
    'consultation',
  );
  must(
    await owner.from('ayurvedic_examinations').insert({
      clinic_id: clinicId, consultation_id: consult.id, patient_id: p1!.id,
      prakriti: 'vata_pitta', vikriti: ['vata'], agni: 'vishama', koshtha: 'krura', bala: 'madhyama',
      nadi: 'Vata-predominant, sarpa gati', jihva: 'Mildly coated', mala: 'Hard, irregular', mutra: 'Normal',
      shabda: 'Clear', sparsha: 'Dry, cool over joints', drik: 'Normal', akriti: 'Madhyama',
      vata_score: 7, pitta_score: 4, kapha_score: 2, ama: 'mild', nidra: 'Light sleep, 5–6 h', appetite: 'Variable', bowel_habits: 'Hard stools, alternate days',
      dinacharya: 'Late dinner, little morning activity',
    }).select('id').single(),
    'examination',
  );
  const rx = must(
    await owner.from('prescriptions').insert({ clinic_id: clinicId, patient_id: p1!.id, doctor_id: ownerId, consultation_id: consult.id, language: 'mr', patient_instructions: 'Avoid cold drinks. Gentle walking every morning.' }).select('id').single(),
    'prescription',
  );
  must(
    await owner.from('prescription_items').insert([
      { clinic_id: clinicId, prescription_id: rx.id, position: 0, medicine_name: 'Yogaraj Guggulu', form: 'vati', dose: '2 tablets', quantity: '120 tablets', frequency: 'Twice daily', timing: 'after_food', anupana: 'Warm water', instructions_mr: 'जेवणानंतर कोमट पाण्यासोबत', duration_days: 30 },
      { clinic_id: clinicId, prescription_id: rx.id, position: 1, medicine_name: 'Dashamoola Kashaya', form: 'kashaya', dose: '15 ml + 45 ml water', frequency: 'Twice daily', timing: 'before_food', duration_days: 30 },
      { clinic_id: clinicId, prescription_id: rx.id, position: 2, medicine_name: 'Mahanarayan Taila', form: 'taila', dose: 'Local application', frequency: 'Once daily', timing: 'as_directed', route: 'topical', instructions_en: 'Warm slightly; massage knees before bath', instructions_mr: 'थोडे कोमट करून आंघोळीपूर्वी गुडघ्यांना मालिश करा', duration_days: 30 },
    ]).select(),
    'prescription items',
  );
  must(await owner.rpc('issue_prescription', { p_prescription: rx.id }), 'issue prescription');
  must(await owner.rpc('finalize_consultation', { p_consultation: consult.id }), 'finalize consultation');
  must(
    await owner.from('investigations').insert({ clinic_id: clinicId, patient_id: p1!.id, consultation_id: consult.id, ordered_by: ownerId, test_name: 'X-ray both knees AP/Lateral', category: 'imaging' }).select().single(),
    'investigation',
  );

  // Billing via RPCs (server computes totals).
  const inv1 = must(
    await staff.rpc('create_invoice', {
      p_clinic: clinicId, p_patient: p1!.id, p_discount_paise: 0, p_notes: null,
      p_items: [
        { description: 'Follow-up consultation', item_type: 'consultation', quantity: 1, unit_price_paise: 30000 },
        { description: 'Janu basti (per sitting)', item_type: 'panchakarma', quantity: 2, unit_price_paise: 80000 },
        { description: 'Mahanarayan Taila 100 ml', item_type: 'medicine', quantity: 1, unit_price_paise: 18000, tax_rate: 12 },
      ],
    }),
    'invoice 1',
  ) as { id: string; total_paise: number };
  must(await staff.rpc('record_payment', { p_invoice: inv1.id, p_amount_paise: inv1.total_paise, p_method: 'upi', p_reference: 'DEMO-UPI-0001' }), 'payment 1');
  const inv2 = must(
    await staff.rpc('create_invoice', {
      p_clinic: clinicId, p_patient: p2!.id, p_discount_paise: 5000, p_notes: 'Senior citizen discount',
      p_items: [{ description: 'New patient consultation', item_type: 'consultation', quantity: 1, unit_price_paise: 50000 }],
    }),
    'invoice 2',
  ) as { id: string };
  must(await staff.rpc('record_payment', { p_invoice: inv2.id, p_amount_paise: 20000, p_method: 'cash' }), 'payment 2');

  console.log(`Seeded demo clinic ${clinicId}. Users: dr.ujjwal@ / admin@ / dr.meera@demo.vaidyora.test (password from DEMO_PASSWORD).`);
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
