import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asOwner, asUser, createDatabase, createUser } from './harness';

interface Fixture {
  db: PGlite;
  clinicA: string;
  clinicB: string;
  ownerA: string; // admin + doctor of clinic A
  adminA: string; // admin only
  doctorA: string; // doctor only
  doctorA2: string; // second doctor
  ownerB: string;
  patientOfDoctor: string;
  patientUnassigned: string;
  patientB: string;
}

let f: Fixture;

async function one<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<T>(sql, params);
  return res.rows[0] as T;
}

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toThrow(pattern);
}

beforeAll(async () => {
  const db = await createDatabase();
  const ownerA = await createUser(db, 'owner-a@example.test', 'Dr. Asha Kulkarni');
  const adminA = await createUser(db, 'admin-a@example.test', 'Rohan Deshpande');
  const doctorA = await createUser(db, 'doctor-a@example.test', 'Dr. Meera Joshi');
  const doctorA2 = await createUser(db, 'doctor-a2@example.test', 'Dr. Vikram Patil');
  const ownerB = await createUser(db, 'owner-b@example.test', 'Dr. Kavita Shinde');

  const clinicA = (await asUser(db, ownerA, (tx) =>
    one<{ id: string }>(tx, `select public.create_clinic('Dhanvantari Ayurveda', 'Pune', null, true) as id`),
  )).id;
  const clinicB = (await asUser(db, ownerB, (tx) =>
    one<{ id: string }>(tx, `select public.create_clinic('Sahyadri Vaidyashala', 'Nashik', null, true) as id`),
  )).id;

  await asOwner(db, async (tx) => {
    // Trial plan allows 2 doctors; this clinic needs 3.
    await tx.query(
      `update public.tenant_subscriptions set status = 'active', plan_id = (select id from public.subscription_plans where code = 'clinic') where clinic_id = $1`,
      [clinicA],
    );
    await tx.query(
      `insert into public.clinic_members (clinic_id, user_id, roles) values
        ($1, $2, '{admin}'), ($1, $3, '{doctor}'), ($1, $4, '{doctor}')`,
      [clinicA, adminA, doctorA, doctorA2],
    );
  });

  const patientOfDoctor = (await asUser(db, adminA, (tx) =>
    one<{ id: string }>(
      tx,
      `insert into public.patients (clinic_id, first_name, last_name, assigned_doctor_id, phone)
       values ($1, 'Sunita', 'Pawar', $2, '+91 98220 11111') returning id`,
      [clinicA, doctorA],
    ),
  )).id;
  const patientUnassigned = (await asUser(db, adminA, (tx) =>
    one<{ id: string }>(tx, `insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Ganesh', 'More') returning id`, [clinicA]),
  )).id;
  const patientB = (await asUser(db, ownerB, (tx) =>
    one<{ id: string }>(tx, `insert into public.patients (clinic_id, first_name) values ($1, 'Lata') returning id`, [clinicB]),
  )).id;

  f = { db, clinicA, clinicB, ownerA, adminA, doctorA, doctorA2, ownerB, patientOfDoctor, patientUnassigned, patientB };
});

describe('tenancy and onboarding', () => {
  it('create_clinic makes the caller an admin+doctor with a primary branch', async () => {
    const perms = await asUser(f.db, f.ownerA, (tx) => tx.query<{ p: string }>(`select public.my_permissions($1) as p`, [f.clinicA]));
    const keys = perms.rows.map((r) => r.p);
    expect(keys).toContain('settings.manage');
    expect(keys).toContain('clinical.write');
    const branch = await asUser(f.db, f.ownerA, (tx) =>
      one<{ n: number }>(tx, `select count(*)::int as n from public.branches where clinic_id = $1 and is_primary`, [f.clinicA]),
    );
    expect(branch.n).toBe(1);
  });

  it('assigns sequential patient codes per clinic', async () => {
    const codes = await asOwner(f.db, (tx) =>
      tx.query<{ patient_code: string }>(`select patient_code from public.patients where clinic_id = $1 order by patient_code`, [f.clinicA]),
    );
    expect(codes.rows.map((r) => r.patient_code)).toEqual(['P-000001', 'P-000002']);
  });

  it('isolates clinics from each other', async () => {
    const seen = await asUser(f.db, f.ownerB, (tx) =>
      tx.query(`select id from public.patients where clinic_id = $1`, [f.clinicA]),
    );
    expect(seen.rows).toHaveLength(0);
    const clinics = await asUser(f.db, f.ownerB, (tx) => tx.query(`select id from public.clinics`));
    expect(clinics.rows).toEqual([{ id: f.clinicB }]);
  });

  it('rejects writing into another tenant', async () => {
    await rejects(
      asUser(f.db, f.ownerB, (tx) => tx.query(`insert into public.patients (clinic_id, first_name) values ($1, 'Intruder')`, [f.clinicA])),
      /row-level security/,
    );
  });

  it('prevents cross-tenant references through composite keys', async () => {
    await rejects(
      asOwner(f.db, (tx) =>
        tx.query(
          `insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at)
           values ($1, $2, $3, now(), now() + interval '30 min')`,
          [f.clinicA, f.patientB, f.doctorA],
        ),
      ),
      /foreign key/,
    );
  });

  it('gives anonymous users nothing', async () => {
    await rejects(asUser(f.db, null, (tx) => tx.query(`select * from public.patients`)), /permission denied/);
  });

  it('keeps at least one active admin', async () => {
    await rejects(
      asUser(f.db, f.ownerB, (tx) => tx.query(`update public.clinic_members set roles = '{doctor}' where clinic_id = $1`, [f.clinicB])),
      /at least one active admin/,
    );
  });
});

describe('patient access', () => {
  it('admins see every patient', async () => {
    const res = await asUser(f.db, f.adminA, (tx) => tx.query(`select id from public.patients`));
    expect(res.rows).toHaveLength(2);
  });

  it('doctors only see assigned or booked patients', async () => {
    const res = await asUser(f.db, f.doctorA, (tx) => tx.query<{ id: string }>(`select id from public.patients`));
    expect(res.rows.map((r) => r.id)).toEqual([f.patientOfDoctor]);
    const other = await asUser(f.db, f.doctorA2, (tx) => tx.query(`select id from public.patients`));
    expect(other.rows).toHaveLength(0);
  });

  it('doctors can only register patients to themselves', async () => {
    await rejects(
      asUser(f.db, f.doctorA, (tx) =>
        tx.query(`insert into public.patients (clinic_id, first_name, assigned_doctor_id) values ($1, 'X', $2)`, [f.clinicA, f.doctorA2]),
      ),
      /row-level security/,
    );
    const mine = await asUser(f.db, f.doctorA, (tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.patients (clinic_id, first_name, assigned_doctor_id) values ($1, 'Walk-in', $2) returning id`,
        [f.clinicA, f.doctorA],
      ),
    );
    expect(mine.id).toBeTruthy();
  });
});

describe('appointments', () => {
  it('lets admins book and doctors see only their own schedule', async () => {
    await asUser(f.db, f.adminA, (tx) =>
      tx.query(
        `insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at)
         values ($1, $2, $3, '2026-11-02 10:00+05:30', '2026-11-02 10:30+05:30')`,
        [f.clinicA, f.patientUnassigned, f.doctorA2],
      ),
    );
    const d1 = await asUser(f.db, f.doctorA, (tx) => tx.query(`select id from public.appointments`));
    const d2 = await asUser(f.db, f.doctorA2, (tx) => tx.query(`select id from public.appointments`));
    expect(d1.rows).toHaveLength(0);
    expect(d2.rows).toHaveLength(1);
    // Booking grants the doctor access to that patient.
    const pts = await asUser(f.db, f.doctorA2, (tx) => tx.query<{ id: string }>(`select id from public.patients`));
    expect(pts.rows.map((r) => r.id)).toEqual([f.patientUnassigned]);
  });

  it('notifies the doctor without leaking patient names', async () => {
    const n = await asUser(f.db, f.doctorA2, (tx) => tx.query<{ title: string }>(`select title from public.notifications`));
    expect(n.rows).toEqual([{ title: 'New appointment booked' }]);
  });

  it('prevents double booking a doctor', async () => {
    await rejects(
      asUser(f.db, f.adminA, (tx) =>
        tx.query(
          `insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at)
           values ($1, $2, $3, '2026-11-02 10:15+05:30', '2026-11-02 10:45+05:30')`,
          [f.clinicA, f.patientOfDoctor, f.doctorA2],
        ),
      ),
      /appointments_no_overlap/,
    );
  });

  it('only allows booking with active doctors', async () => {
    await rejects(
      asUser(f.db, f.adminA, (tx) =>
        tx.query(
          `insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at)
           values ($1, $2, $3, '2026-11-03 10:00+05:30', '2026-11-03 10:30+05:30')`,
          [f.clinicA, f.patientOfDoctor, f.adminA],
        ),
      ),
      /not an active doctor/,
    );
  });

  it('enforces the status state machine', async () => {
    const appt = await asUser(f.db, f.doctorA2, (tx) => one<{ id: string }>(tx, `select id from public.appointments limit 1`));
    await rejects(
      asUser(f.db, f.doctorA2, (tx) => tx.query(`select public.set_appointment_status($1, 'cancelled')`, [appt.id])),
      /cancellation reason/,
    );
    await asUser(f.db, f.doctorA2, (tx) => tx.query(`select public.set_appointment_status($1, 'checked_in')`, [appt.id]));
    await rejects(
      asUser(f.db, f.doctorA2, (tx) => tx.query(`select public.set_appointment_status($1, 'scheduled')`, [appt.id])),
      /Cannot change appointment/,
    );
    // Another doctor cannot touch it.
    await rejects(
      asUser(f.db, f.doctorA, (tx) => tx.query(`select public.set_appointment_status($1, 'no_show')`, [appt.id])),
      /Not permitted/,
    );
  });
});

describe('clinical records', () => {
  let consultationId: string;

  it('admins without the doctor role cannot read or write clinical notes', async () => {
    await rejects(
      asUser(f.db, f.adminA, (tx) =>
        tx.query(
          `insert into public.consultations (clinic_id, patient_id, doctor_id, chief_complaint) values ($1, $2, $3, 'x')`,
          [f.clinicA, f.patientOfDoctor, f.adminA],
        ),
      ),
      /row-level security|foreign key/,
    );
  });

  it('doctors document consultations for their own patients only', async () => {
    const c = await asUser(f.db, f.doctorA, (tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.consultations (clinic_id, patient_id, doctor_id, chief_complaint, pulse_bpm)
         values ($1, $2, $3, 'Joint pain for 3 months', 78) returning id`,
        [f.clinicA, f.patientOfDoctor, f.doctorA],
      ),
    );
    consultationId = c.id;
    await asUser(f.db, f.doctorA, (tx) =>
      tx.query(
        `insert into public.ayurvedic_examinations (clinic_id, consultation_id, patient_id, prakriti, vikriti, agni, nadi)
         values ($1, $2, $3, 'vata_pitta', '{vata}', 'vishama', 'Vata-predominant, sarpa gati')`,
        [f.clinicA, consultationId, f.patientOfDoctor],
      ),
    );
    await rejects(
      asUser(f.db, f.doctorA2, (tx) =>
        tx.query(
          `insert into public.consultations (clinic_id, patient_id, doctor_id, chief_complaint) values ($1, $2, $3, 'x')`,
          [f.clinicA, f.patientOfDoctor, f.doctorA2],
        ),
      ),
      /row-level security/,
    );
    const adminView = await asUser(f.db, f.adminA, (tx) => tx.query(`select id from public.consultations`));
    expect(adminView.rows).toHaveLength(0);
  });

  it('locks consultations once finalized', async () => {
    await asUser(f.db, f.doctorA, (tx) => tx.query(`select public.finalize_consultation($1)`, [consultationId]));
    const upd = await asUser(f.db, f.doctorA, (tx) =>
      tx.query(`update public.consultations set diagnosis = 'changed' where id = $1`, [consultationId]),
    );
    expect(upd.affectedRows).toBe(0); // RLS hides finalized rows from UPDATE
    await rejects(
      asOwner(f.db, (tx) => tx.query(`update public.consultations set diagnosis = 'changed' where id = $1`, [consultationId])),
      /cannot be modified/,
    );
  });

  it('numbers prescriptions on issue and freezes their items', async () => {
    const rx = await asUser(f.db, f.doctorA, (tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.prescriptions (clinic_id, patient_id, doctor_id, consultation_id) values ($1, $2, $3, $4) returning id`,
        [f.clinicA, f.patientOfDoctor, f.doctorA, consultationId],
      ),
    );
    await rejects(
      asUser(f.db, f.doctorA, (tx) => tx.query(`select public.issue_prescription($1, true)`, [rx.id])),
      /at least one medicine/,
    );
    await asUser(f.db, f.doctorA, (tx) =>
      tx.query(
        `insert into public.prescription_items (clinic_id, prescription_id, medicine_name, form, dose, frequency, anupana, duration_days)
         values ($1, $2, 'Yogaraj Guggulu', 'vati', '2 tablets', 'Twice daily', 'Warm water', 30)`,
        [f.clinicA, rx.id],
      ),
    );
    // Cannot self-issue by setting a number directly.
    await rejects(
      asUser(f.db, f.doctorA, (tx) =>
        tx.query(`update public.prescriptions set status = 'issued', issued_at = now(), prescription_no = 'FAKE' where id = $1`, [rx.id]),
      ),
      /row-level security|issued and revised only through/,
    );
    const issued = await asUser(f.db, f.doctorA, (tx) =>
      one<{ prescription_no: string }>(tx, `select (public.issue_prescription($1, true)).prescription_no`, [rx.id]),
    );
    expect(issued.prescription_no).toMatch(/^RX-\d{4}-000001$/);
    await rejects(
      asUser(f.db, f.doctorA, (tx) =>
        tx.query(
          `insert into public.prescription_items (clinic_id, prescription_id, medicine_name, dose, frequency) values ($1, $2, 'X', '1', '1')`,
          [f.clinicA, rx.id],
        ),
      ),
      /row-level security|cannot be changed/,
    );
  });
});

describe('billing', () => {
  let invoiceId: string;

  it('computes totals on the server', async () => {
    const inv = await asUser(f.db, f.adminA, (tx) =>
      one<{ id: string; total_paise: number; subtotal_paise: number; tax_paise: number; invoice_no: string; status: string }>(
        tx,
        `select (i).* from (select public.create_invoice($1, $2, $3::jsonb, 5000) as i) s`,
        [
          f.clinicA,
          f.patientOfDoctor,
          JSON.stringify([
            { description: 'Consultation', item_type: 'consultation', quantity: 1, unit_price_paise: 50000 },
            { description: 'Mahanarayan Taila 100 ml', item_type: 'medicine', quantity: 2, unit_price_paise: 18000, tax_rate: 12 },
          ]),
        ],
      ),
    );
    invoiceId = inv.id;
    expect(Number(inv.subtotal_paise)).toBe(86000);
    expect(Number(inv.tax_paise)).toBe(4320);
    expect(Number(inv.total_paise)).toBe(86000 + 4320 - 5000);
    expect(inv.invoice_no).toMatch(/^INV-\d{4}-000001$/);
    expect(inv.status).toBe('issued');
  });

  it('blocks direct writes and non-billing roles', async () => {
    await rejects(
      asUser(f.db, f.adminA, (tx) => tx.query(`update public.invoices set total_paise = 1 where id = $1`, [invoiceId])),
      /permission denied/,
    );
    await rejects(
      asUser(f.db, f.doctorA, (tx) =>
        tx.query(`select public.create_invoice($1, $2, '[{"description":"x","quantity":1,"unit_price_paise":1}]'::jsonb)`, [
          f.clinicA,
          f.patientOfDoctor,
        ]),
      ),
      /Not permitted/,
    );
    const seen = await asUser(f.db, f.doctorA, (tx) => tx.query(`select id from public.invoices`));
    expect(seen.rows).toHaveLength(0);
  });

  it('records partial and full payments and rejects overpayment', async () => {
    await asUser(f.db, f.adminA, (tx) => tx.query(`select public.record_payment($1, 40000, 'upi', 'UPI-REF-1')`, [invoiceId]));
    let inv = await asUser(f.db, f.adminA, (tx) =>
      one<{ status: string; amount_paid_paise: number }>(tx, `select status, amount_paid_paise from public.invoices where id = $1`, [invoiceId]),
    );
    expect(inv.status).toBe('partially_paid');
    await rejects(
      asUser(f.db, f.adminA, (tx) => tx.query(`select public.record_payment($1, 99999999, 'cash')`, [invoiceId])),
      /exceeds the outstanding balance/,
    );
    await asUser(f.db, f.adminA, (tx) => tx.query(`select public.record_payment($1, 45320, 'cash')`, [invoiceId]));
    inv = await asUser(f.db, f.adminA, (tx) =>
      one<{ status: string; amount_paid_paise: number }>(tx, `select status, amount_paid_paise from public.invoices where id = $1`, [invoiceId]),
    );
    expect(inv.status).toBe('paid');
    await rejects(
      asUser(f.db, f.adminA, (tx) => tx.query(`select public.void_invoice($1, 'mistake')`, [invoiceId])),
      /cannot be voided/,
    );
  });

  it('reports collections for authorised roles only', async () => {
    const summary = await asUser(f.db, f.adminA, (tx) =>
      one<{ s: { collected_this_month_paise: number } }>(tx, `select public.dashboard_summary($1) as s`, [f.clinicA]),
    );
    expect(Number(summary.s.collected_this_month_paise)).toBe(85320);
    await rejects(
      asUser(f.db, f.doctorA, (tx) => tx.query(`select * from public.revenue_report($1, current_date - 7, current_date)`, [f.clinicA])),
      /Not permitted/,
    );
  });
});

describe('audit log', () => {
  it('records actions and changed field names without values', async () => {
    const logs = await asUser(f.db, f.adminA, (tx) =>
      tx.query<{ action: string; entity_type: string; changed_fields: string[] }>(
        `select action, entity_type, changed_fields from public.audit_events where entity_type = 'invoices' order by id`,
      ),
    );
    expect(logs.rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(logs.rows);
    expect(serialized).not.toContain('Sunita');
    expect(logs.rows.at(-1)!.changed_fields).toContain('amount_paid_paise');
  });

  it('is invisible to doctors', async () => {
    const logs = await asUser(f.db, f.doctorA, (tx) => tx.query(`select id from public.audit_events`));
    expect(logs.rows).toHaveLength(0);
  });
});

describe('storage policies', () => {
  it('scopes patient file uploads to a pending document row of the uploader', async () => {
    const doc = await asUser(f.db, f.doctorA, (tx) =>
      one<{ storage_path: string }>(
        tx,
        `insert into public.patient_documents (clinic_id, patient_id, title, file_name, mime_type, size_bytes)
         values ($1, $2, 'Knee X-ray', 'xray.pdf', 'application/pdf', 2048) returning storage_path`,
        [f.clinicA, f.patientOfDoctor],
      ),
    );
    await asUser(f.db, f.doctorA, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('clinic-files', $1)`, [doc.storage_path]));
    // Arbitrary paths, even inside the patient's folder, are refused.
    await rejects(
      asUser(f.db, f.doctorA, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name) values ('clinic-files', $1)`, [`${f.clinicA}/patients/${f.patientOfDoctor}/x.pdf`]),
      ),
      /row-level security/,
    );
    await rejects(
      asUser(f.db, f.adminA, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('clinic-files', $1)`, [doc.storage_path])),
      /row-level security/,
    );
    // No client can list patient files directly; downloads go through the Edge Function.
    const listed = await asUser(f.db, f.doctorA, (tx) => tx.query(`select id from storage.objects`));
    expect(listed.rows).toHaveLength(0);
  });
});

describe('transactional clinical saves', () => {
  it('saves a consultation with its examination atomically and starts the visit', async () => {
    const appt = await asUser(f.db, f.adminA, (tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at)
         values ($1, $2, $3, '2026-11-05 09:00+05:30', '2026-11-05 09:30+05:30') returning id`,
        [f.clinicA, f.patientOfDoctor, f.doctorA],
      ),
    );
    const id = await asUser(f.db, f.doctorA, (tx) =>
      one<{ id: string }>(tx, `select public.save_consultation($1, null, $2::jsonb, $3::jsonb) as id`, [
        f.clinicA,
        JSON.stringify({ patient_id: f.patientOfDoctor, appointment_id: appt.id, chief_complaint: 'Acidity after meals', pulse_bpm: 82 }),
        JSON.stringify({ prakriti: 'pitta', vikriti: ['pitta'], agni: 'tikshna', jihva: 'Red, slightly coated' }),
      ]),
    );
    const row = await asUser(f.db, f.doctorA, (tx) =>
      one<{ agni: string; status: string }>(
        tx,
        `select e.agni, a.status from public.ayurvedic_examinations e
         join public.consultations c on c.id = e.consultation_id
         join public.appointments a on a.id = c.appointment_id where c.id = $1`,
        [id.id],
      ),
    );
    expect(row).toEqual({ agni: 'tikshna', status: 'in_consultation' });

    // Update path, then a failing examination value rolls everything back.
    await rejects(
      asUser(f.db, f.doctorA, (tx) =>
        tx.query(`select public.save_consultation($1, $2, $3::jsonb, $4::jsonb)`, [
          f.clinicA,
          id.id,
          JSON.stringify({ patient_id: f.patientOfDoctor, chief_complaint: 'Changed complaint' }),
          JSON.stringify({ agni: 'not-a-real-agni' }),
        ]),
      ),
      /invalid input value for enum/,
    );
    const unchanged = await asUser(f.db, f.doctorA, (tx) =>
      one<{ chief_complaint: string }>(tx, `select chief_complaint from public.consultations where id = $1`, [id.id]),
    );
    expect(unchanged.chief_complaint).toBe('Acidity after meals');
  });

  it('other doctors cannot save into a colleague’s consultation', async () => {
    const c = await asUser(f.db, f.doctorA, (tx) =>
      one<{ id: string }>(tx, `select id from public.consultations where status = 'draft' limit 1`),
    );
    await rejects(
      asUser(f.db, f.doctorA2, (tx) =>
        tx.query(`select public.save_consultation($1, $2, $3::jsonb, '{}'::jsonb)`, [
          f.clinicA,
          c.id,
          JSON.stringify({ patient_id: f.patientOfDoctor, chief_complaint: 'Hijack' }),
        ]),
      ),
      /Not permitted/,
    );
  });

  it('replaces draft prescription items in one transaction', async () => {
    const rxId = await asUser(f.db, f.doctorA, (tx) =>
      one<{ id: string }>(tx, `select public.save_prescription_draft($1, null, $2, null, '{"notes":"Note"}'::jsonb, $3::jsonb) as id`, [
        f.clinicA,
        f.patientOfDoctor,
        JSON.stringify([
          { medicine_name: 'Avipattikar Churna', form: 'churna', dose: '3 g', frequency: 'Twice daily', timing: 'before_food', anupana: 'Lukewarm water' },
          { medicine_name: 'Kamdudha Ras', form: 'vati', dose: '1 tablet', frequency: 'Twice daily' },
        ]),
      ]),
    );
    await asUser(f.db, f.doctorA, (tx) =>
      tx.query(`select public.save_prescription_draft($1, $2, $3, null, '{"notes":"Updated"}'::jsonb, $4::jsonb)`, [
        f.clinicA,
        rxId.id,
        f.patientOfDoctor,
        JSON.stringify([{ medicine_name: 'Shatavari Churna', form: 'churna', dose: '3 g', frequency: 'Once daily' }]),
      ]),
    );
    const items = await asUser(f.db, f.doctorA, (tx) =>
      tx.query<{ medicine_name: string; position: number }>(`select medicine_name, position from public.prescription_items where prescription_id = $1`, [rxId.id]),
    );
    expect(items.rows).toEqual([{ medicine_name: 'Shatavari Churna', position: 0 }]);
  });
});
