import { beforeAll, describe, expect, it } from 'vitest';
import { asOwner, asUser } from './harness';
import { book, consult, count, createWorld, expectError, registerPatient, roleId, type World } from './world';

let w: World;
let patient: string; // registered and seen at Main
let dhanoriPatient: string; // registered and seen at Dhanori only
let consultation: string;
let prescription: string;
let dhanoriAppointment: string;

beforeAll(async () => {
  w = await createWorld();
  patient = await registerPatient(w.db, w.receptionist.userId, w.main, 'Sunita');
  dhanoriPatient = await registerPatient(w.db, w.dhanoriReception.userId, w.dhanori, 'Ramesh');
  const appt = await book(w.db, w.receptionist.userId, w.main, patient);
  dhanoriAppointment = await book(w.db, w.dhanoriReception.userId, w.dhanori, dhanoriPatient);
  consultation = await consult(w.db, w.doctor, w.main, patient, appt);
  await consult(w.db, w.doctor, w.dhanori, dhanoriPatient, dhanoriAppointment);
  await asUser(w.db, w.doctor, (tx) => tx.query(`select public.save_medical_profile($1, '{"allergies":"Penicillin","blood_group":"B+"}'::jsonb)`, [patient]));
  prescription = await asUser(w.db, w.doctor, async (tx) =>
    (await tx.query<{ save_prescription_draft: string }>(`select public.save_prescription_draft(null, $1, $2, '{}'::jsonb, $3::jsonb)`, [
      patient, consultation, JSON.stringify([{ medicine_name: 'Ashwagandha churna', dose: '3 g', frequency: 'Twice daily' }]),
    ])).rows[0]!.save_prescription_draft,
  );
});

describe('a receptionist', () => {
  it('cannot read consultation notes, examinations, prescriptions or medical history by any query', async () => {
    const r = w.receptionist.userId;
    for (const sql of [
      'select * from public.consultations',
      'select * from public.ayurvedic_examinations',
      'select * from public.prescriptions',
      'select * from public.prescription_items',
      'select * from public.prescription_revisions',
      'select * from public.patient_medical_profiles',
      'select * from public.investigations',
      'select * from public.patient_documents',
      'select * from public.consultation_amendments',
    ]) {
      expect(await count(w.db, r, sql), sql).toBe(0);
    }
    expect(await count(w.db, r, `select 1 from public.consultations where id = $1`, [consultation])).toBe(0);
  });

  it('cannot write clinical records even with a hand-made request', async () => {
    const r = w.receptionist.userId;
    await expectError(() => asUser(w.db, r, (tx) => tx.query(`insert into public.consultations (patient_id, branch_id, chief_complaint) values ($1, $2, 'x')`, [patient, w.main])), '42501');
    await expectError(() => asUser(w.db, r, (tx) => tx.query(`select public.save_consultation(null, $1::jsonb, null)`, [JSON.stringify({ patient_id: patient, branch_id: w.main, chief_complaint: 'x' })])), '42501');
    await expectError(() => asUser(w.db, r, (tx) => tx.query(`select public.finalize_consultation($1)`, [consultation])), '42501');
    await expectError(() => asUser(w.db, r, (tx) => tx.query(`select public.issue_prescription($1, true)`, [prescription])), '42501');
    await expectError(() => asUser(w.db, r, (tx) => tx.query(`select public.save_medical_profile($1, '{"allergies":"none"}'::jsonb)`, [patient])), '42501');
  });

  it('sees patients organization-wide (to find returning patients) but only the schedule of their branch', async () => {
    const r = w.receptionist.userId;
    expect(await count(w.db, r, 'select 1 from public.patients where id = $1', [dhanoriPatient])).toBe(1);
    expect(await count(w.db, r, 'select 1 from public.appointments where id = $1', [dhanoriAppointment])).toBe(0);
    await expectError(() => book(w.db, r, w.dhanori, dhanoriPatient), '42501');
    await expectError(() => asUser(w.db, r, (tx) => tx.query(`select public.set_appointment_status($1, 'checked_in')`, [dhanoriAppointment])), '42501');
  });

  it('may edit contact details but not identity fields', async () => {
    const r = w.receptionist.userId;
    await asUser(w.db, r, (tx) => tx.query(`update public.patients set phone = '+91 98765 43210' where id = $1`, [patient]));
    await expectError(() => asUser(w.db, r, (tx) => tx.query(`update public.patients set first_name = 'Changed' where id = $1`, [patient])), '42501');
    await expectError(() => asUser(w.db, r, (tx) => tx.query(`update public.patients set status = 'inactive' where id = $1`, [patient])), '42501');
  });

  it('gains clinical read only when explicitly granted, and then only at their branches', async () => {
    const reception = await roleId(w.db, 'receptionist');
    await asUser(w.db, w.admin, (tx) =>
      tx.query(`select public.set_staff_access($1, $2, '{"consultations.view":"grant","patients.view_history":"grant"}'::jsonb)`, [w.receptionist.staffId, reception]),
    );
    const r = w.receptionist.userId;
    expect(await count(w.db, r, 'select 1 from public.consultations')).toBe(1); // Main only
    expect(await count(w.db, r, 'select 1 from public.patient_medical_profiles where patient_id = $1', [patient])).toBe(1);
    await asUser(w.db, w.admin, (tx) => tx.query(`select public.set_staff_access($1, $2, '{}'::jsonb)`, [w.receptionist.staffId, reception]));
    expect(await count(w.db, r, 'select 1 from public.consultations')).toBe(0);
  });
});

describe('an accountant', () => {
  it('has no patient access by default, except patients they bill at their branch', async () => {
    const a = w.accountant.userId;
    expect(await count(w.db, a, 'select 1 from public.patients')).toBe(0);
    await asUser(w.db, a, (tx) => tx.query(`select public.create_invoice($1, '[{"description":"Consultation","quantity":1,"unit_price_paise":50000}]'::jsonb, 0, null, null, $2)`, [patient, w.main]));
    expect(await count(w.db, a, 'select 1 from public.patients')).toBe(1);
    expect(await count(w.db, a, 'select 1 from public.patients where id = $1', [dhanoriPatient])).toBe(0);
  });

  it('cannot bill at a branch they are not assigned to', async () => {
    await expectError(
      () => asUser(w.db, w.accountant.userId, (tx) => tx.query(`select public.create_invoice($1, '[{"description":"Visit","quantity":1,"unit_price_paise":100}]'::jsonb, 0, null, null, $2)`, [dhanoriPatient, w.dhanori])),
      '42501',
    );
  });
});

describe('a branch manager', () => {
  it('works only within their branch', async () => {
    const m = w.manager.userId;
    expect(await count(w.db, m, 'select 1 from public.appointments where id = $1', [dhanoriAppointment])).toBe(1);
    expect(await count(w.db, m, `select 1 from public.appointments where branch_id = $1`, [w.main])).toBe(0);
    expect(await count(w.db, m, 'select 1 from public.consultations')).toBe(0); // no clinical access by default
    await expectError(() => asUser(w.db, m, (tx) => tx.query(`select public.org_overview($1)`, [w.main])), '42501');
    const overview = await asUser(w.db, m, async (tx) => (await tx.query<{ org_overview: Record<string, number> }>(`select public.org_overview()`)).rows[0]!.org_overview);
    expect(overview.branches_active).toBe(1);
  });
});

describe('the administrator', () => {
  it('can read clinical records but never write them', async () => {
    expect(await count(w.db, w.admin, 'select 1 from public.consultations')).toBe(2);
    expect(await count(w.db, w.admin, 'select 1 from public.ayurvedic_examinations')).toBe(2);
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`update public.consultations set treatment_plan = 'changed' where id = $1`, [consultation])).then((r) => {
      if (r.affectedRows === 0) throw Object.assign(new Error('blocked'), { code: '42501' });
    }), '42501');
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`select public.finalize_consultation($1)`, [consultation])), '42501');
  });

  it('does not see the doctor\'s draft prescriptions, only issued ones', async () => {
    expect(await count(w.db, w.admin, 'select 1 from public.prescriptions where id = $1', [prescription])).toBe(0);
    await asUser(w.db, w.doctor, (tx) => tx.query(`select public.issue_prescription($1, true)`, [prescription]));
    expect(await count(w.db, w.admin, 'select 1 from public.prescriptions where id = $1', [prescription])).toBe(1);
  });
});

describe('the primary doctor', () => {
  it('sees clinical records at every branch', async () => {
    expect(await count(w.db, w.doctor, 'select 1 from public.consultations')).toBe(2);
    expect(await count(w.db, w.doctor, 'select 1 from public.patient_medical_profiles')).toBe(1);
  });

  it('finalizes consultations, which then become immutable and create follow-ups', async () => {
    await asUser(w.db, w.doctor, (tx) => tx.query(`update public.consultations set follow_up_date = current_date + 14 where id = $1`, [consultation]));
    await asUser(w.db, w.doctor, (tx) => tx.query(`select public.finalize_consultation($1)`, [consultation]));
    const changed = await asUser(w.db, w.doctor, async (tx) => (await tx.query(`update public.consultations set diagnosis = 'x' where id = $1`, [consultation])).affectedRows);
    expect(changed).toBe(0);
    // Even the owner, bypassing RLS, hits the lock trigger.
    await expectError(() => asOwner(w.db, (tx) => tx.query(`update public.consultations set diagnosis = 'x' where id = $1`, [consultation])), '42501');
    expect(await count(w.db, w.receptionist.userId, 'select 1 from public.follow_ups where consultation_id = $1', [consultation])).toBe(1);
    await asUser(w.db, w.doctor, (tx) => tx.query(`insert into public.consultation_amendments (consultation_id, reason, content) values ($1, 'Correction', 'Dose clarified')`, [consultation]));
  });

  it('is the only one who can change investigation results', async () => {
    const inv = await asUser(w.db, w.doctor, async (tx) =>
      (await tx.query<{ id: string }>(`insert into public.investigations (patient_id, consultation_id, test_name) values ($1, $2, 'CBC') returning id`, [patient, consultation])).rows[0]!.id,
    );
    // Admin tracks the status but cannot write the result.
    await asUser(w.db, w.admin, (tx) => tx.query(`update public.investigations set status = 'sample_collected' where id = $1`, [inv]));
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`update public.investigations set result_summary = 'Normal' where id = $1`, [inv])), '42501');
    await asUser(w.db, w.doctor, (tx) => tx.query(`update public.investigations set status = 'resulted', result_summary = 'Within limits' where id = $1`, [inv]));
  });
});

describe('documents', () => {
  it('are uploaded only by holders of the upload permission and opened only by clinical viewers', async () => {
    await expectError(
      () => asUser(w.db, w.receptionist.userId, (tx) => tx.query(`insert into public.patient_documents (patient_id, branch_id, title, file_name, mime_type, size_bytes) values ($1, $2, 'Report', 'r.pdf', 'application/pdf', 100)`, [patient, w.main])),
      '42501',
    );
    const doc = await asUser(w.db, w.doctor, async (tx) =>
      (await tx.query<{ id: string; storage_path: string }>(`insert into public.patient_documents (patient_id, branch_id, title, file_name, mime_type, size_bytes) values ($1, $2, 'Report', 'r.pdf', 'application/pdf', 100) returning id, storage_path`, [patient, w.main])).rows[0]!,
    );
    expect(doc.storage_path).toBe(`patients/${patient}/${doc.id}.pdf`);
    expect(await count(w.db, w.receptionist.userId, `select 1 from public.patient_documents`)).toBe(0);
    const canUpload = (u: string) => asUser(w.db, u, async (tx) => (await tx.query<{ ok: boolean }>(`select private.storage_can_upload($1) as ok`, [doc.storage_path])).rows[0]!.ok);
    expect(await canUpload(w.doctor)).toBe(true);
    expect(await canUpload(w.receptionist.userId)).toBe(false);
  });
});

describe('audit trail', () => {
  it('records clinical views and changes without clinical values', async () => {
    await asUser(w.db, w.admin, (tx) => tx.query(`select public.view_patient($1)`, [patient]));
    const rows = await asOwner(w.db, async (tx) => (await tx.query<{ metadata: unknown; changed_fields: string[] }>(`select metadata, changed_fields from public.audit_events where entity_type in ('consultations', 'patient_medical_profiles')`)).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/Penicillin|Joint pain|Abhyanga/);
    expect(await count(w.db, w.admin, `select 1 from public.audit_events where event_type = 'patients.viewed' and entity_id = $1`, [patient])).toBe(1);
  });

  it('is append-only and hidden from staff without audit access', async () => {
    await expectError(() => asOwner(w.db, (tx) => tx.query(`update public.audit_events set action = 'view'`)), '42501');
    expect(await count(w.db, w.receptionist.userId, 'select 1 from public.audit_events')).toBe(0);
  });
});
