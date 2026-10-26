/**
 * Phase 7–8 database guarantees: aggregate dashboards that never expose
 * record contents, admin prescription access limited to issued versions,
 * clinician confirmation on issue, amendments, reconciliation, access reviews,
 * recently viewed patients and validated clinic preferences.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asOwner, asUser, createDatabase, createUser, setPlan } from './harness';

type IdKey = 'owner' | 'admin' | 'doctor' | 'doctor2' | 'other' | 'clinic' | 'otherClinic' | 'patient' | 'patient2' | 'consult' | 'rx' | 'draftRx' | 'invoice' | 'payment';
const ids = {} as Record<IdKey, string>;
let db: PGlite;

async function one<T>(tx: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  return (await tx.query<T>(sql, params)).rows[0] as T;
}
async function rejects(p: Promise<unknown>, re: RegExp) {
  await expect(p).rejects.toThrow(re);
}

beforeAll(async () => {
  db = await createDatabase();
  ids.owner = await createUser(db, 'owner@example.test', 'Dr. Owner');
  ids.admin = await createUser(db, 'admin@example.test', 'Front Desk');
  ids.doctor = await createUser(db, 'doctor@example.test', 'Dr. Meera Joshi');
  ids.doctor2 = await createUser(db, 'doctor2@example.test', 'Dr. Vikram Patil');
  ids.other = await createUser(db, 'other@example.test', 'Dr. Elsewhere');
  ids.clinic = (await asUser(db, ids.owner, (tx) => one<{ id: string }>(tx, `select public.create_clinic('Dhanvantari', 'Pune') as id`))).id;
  ids.otherClinic = (await asUser(db, ids.other, (tx) => one<{ id: string }>(tx, `select public.create_clinic('Elsewhere', 'Nagpur') as id`))).id;
  await setPlan(db, ids.clinic, 'clinic');
  await asOwner(db, (tx) =>
    tx.query(`insert into public.clinic_members (clinic_id, user_id, roles, accepted_at) values ($1, $2, '{admin}', now()), ($1, $3, '{doctor}', now()), ($1, $4, '{doctor}', now())`, [
      ids.clinic, ids.admin, ids.doctor, ids.doctor2,
    ]),
  );
  ids.patient = (await asUser(db, ids.admin, (tx) =>
    one<{ id: string }>(tx, `insert into public.patients (clinic_id, first_name, last_name, gender, assigned_doctor_id) values ($1, 'Sunita', 'Pawar', 'female', $2) returning id`, [ids.clinic, ids.doctor]),
  )).id;
  ids.patient2 = (await asUser(db, ids.admin, (tx) =>
    one<{ id: string }>(tx, `insert into public.patients (clinic_id, first_name, assigned_doctor_id) values ($1, 'Ganesh', $2) returning id`, [ids.clinic, ids.doctor]),
  )).id;
  ids.consult = (await asUser(db, ids.doctor, (tx) =>
    one<{ id: string }>(tx, `select public.save_consultation($1, null, $2::jsonb, $3::jsonb) as id`, [
      ids.clinic,
      JSON.stringify({ patient_id: ids.patient, chief_complaint: 'Knee pain', pain_details: 'Dull ache, worse in cold', doctor_notes: 'Private note' }),
      JSON.stringify({ family_history_maternal: 'Mother: osteoarthritis', family_history_paternal: 'Father: diabetes', family_history_self: 'None', menstrual_history: 'Menopause at 50' }),
    ]),
  )).id;
  ids.rx = (await asUser(db, ids.doctor, (tx) =>
    one<{ id: string }>(tx, `select public.save_prescription_draft($1, null, $2, $3, '{}'::jsonb, '[{"medicine_name":"Yogaraj Guggulu","dose":"2 tablets","frequency":"Twice daily"}]'::jsonb) as id`, [ids.clinic, ids.patient, ids.consult]),
  )).id;
  ids.draftRx = (await asUser(db, ids.doctor, (tx) =>
    one<{ id: string }>(tx, `select public.save_prescription_draft($1, null, $2, null, '{}'::jsonb, '[{"medicine_name":"Triphala","dose":"3 g","frequency":"At bedtime"}]'::jsonb) as id`, [ids.clinic, ids.patient2]),
  )).id;
  ids.invoice = (await asUser(db, ids.admin, (tx) =>
    one<{ id: string }>(tx, `select (public.create_invoice($1, $2, '[{"description":"Consultation","quantity":1,"unit_price_paise":50000}]'::jsonb)).id`, [ids.clinic, ids.patient]),
  )).id;
  ids.payment = (await asUser(db, ids.admin, (tx) => one<{ id: string }>(tx, `select (public.record_payment($1, 30000, 'upi', 'UTR123')).id`, [ids.invoice]))).id;
});

describe('patient history form fields', () => {
  it('stores वेदना विशेष, family history (मातृज/पितृज/स्वकुल) and रजोइतिहास', async () => {
    const r = await asUser(db, ids.doctor, (tx) =>
      one<{ pain_details: string; family_history_maternal: string; family_history_self: string; menstrual_history: string }>(
        tx,
        `select c.pain_details, e.family_history_maternal, e.family_history_self, e.menstrual_history
         from public.consultations c join public.ayurvedic_examinations e on e.consultation_id = c.id where c.id = $1`,
        [ids.consult],
      ),
    );
    expect(r).toEqual({ pain_details: 'Dull ache, worse in cold', family_history_maternal: 'Mother: osteoarthritis', family_history_self: 'None', menstrual_history: 'Menopause at 50' });
  });
});

describe('issuing prescriptions', () => {
  it('requires the clinician to confirm the review', async () => {
    await rejects(asUser(db, ids.doctor, (tx) => tx.query(`select public.issue_prescription($1, false)`, [ids.rx])), /Confirm that you have reviewed/);
    await asUser(db, ids.doctor, (tx) => tx.query(`select public.issue_prescription($1, true)`, [ids.rx]));
    const rev = await asUser(db, ids.doctor, (tx) => one<{ c: boolean }>(tx, `select (snapshot ->> 'clinician_confirmed')::boolean as c from public.prescription_revisions where prescription_id = $1`, [ids.rx]));
    expect(rev.c).toBe(true);
  });

  it('lets admins see issued prescriptions and their revisions, but never drafts or consultation notes', async () => {
    const rows = await asUser(db, ids.admin, (tx) => tx.query<{ id: string; status: string }>(`select id, status from public.prescriptions`));
    expect(rows.rows).toEqual([{ id: ids.rx, status: 'issued' }]);
    expect((await asUser(db, ids.admin, (tx) => tx.query(`select id from public.prescription_revisions`))).rows).toHaveLength(1);
    expect((await asUser(db, ids.admin, (tx) => tx.query(`select id from public.prescription_items where prescription_id = $1`, [ids.draftRx]))).rows).toHaveLength(0);
    expect((await asUser(db, ids.admin, (tx) => tx.query(`select id from public.consultations`))).rows).toHaveLength(0);
    await rejects(asUser(db, ids.admin, (tx) => tx.query(`select public.revise_prescription($1, 'x')`, [ids.rx])), /Not permitted/);
  });
});

describe('consultation amendments', () => {
  it('only the treating doctor can amend, only after finalizing, and amendments are immutable', async () => {
    const add = (user: string) =>
      asUser(db, user, (tx) =>
        tx.query(`insert into public.consultation_amendments (clinic_id, consultation_id, reason, content) values ($1, $2, 'Correction', 'BP was 132/84, not 128/82')`, [ids.clinic, ids.consult]),
      );
    await rejects(add(ids.doctor), /row-level security/); // still a draft
    await asUser(db, ids.doctor, (tx) => tx.query(`select public.finalize_consultation($1)`, [ids.consult]));
    await add(ids.doctor);
    await rejects(add(ids.doctor2), /row-level security/);
    await rejects(add(ids.admin), /row-level security/);
    await rejects(asOwner(db, (tx) => tx.query(`update public.consultation_amendments set content = 'x'`)), /immutable/);
    expect((await asUser(db, ids.admin, (tx) => tx.query(`select id from public.consultation_amendments`))).rows).toHaveLength(0);
  });
});

describe('payment reconciliation', () => {
  it('lets billing staff reconcile but never change payment amounts', async () => {
    await rejects(asUser(db, ids.doctor, (tx) => tx.query(`select public.reconcile_payment($1, true, 'SETTLE-1')`, [ids.payment])), /Not permitted/);
    const r = await asUser(db, ids.admin, (tx) =>
      one<{ reconciled_at: string | null; settlement_reference: string }>(tx, `select (p).reconciled_at, (p).settlement_reference from (select public.reconcile_payment($1, true, 'SETTLE-1', 'Matched UPI settlement') p) s`, [ids.payment]),
    );
    expect(r.reconciled_at).not.toBeNull();
    expect(r.settlement_reference).toBe('SETTLE-1');
    await rejects(asOwner(db, (tx) => tx.query(`update public.payments set amount_paise = 1 where id = $1`, [ids.payment])), /record a refund instead/);
    const undone = await asUser(db, ids.admin, (tx) => one<{ reconciled_at: string | null }>(tx, `select (public.reconcile_payment($1, false)).reconciled_at`, [ids.payment]));
    expect(undone.reconciled_at).toBeNull();
  });
});

describe('admin aggregates', () => {
  it('returns counts without record contents and refuses doctors', async () => {
    const o = await asUser(db, ids.admin, (tx) =>
      one<{ o: Record<string, number> }>(tx, `select public.clinic_overview($1, current_date - 30, current_date) as o`, [ids.clinic]),
    );
    expect(Number(o.o.consultations_completed)).toBe(1);
    expect(Number(o.o.patients_new)).toBe(2);
    expect(Number(o.o.collected_paise)).toBe(30000);
    expect(Number(o.o.outstanding_paise)).toBe(20000);
    expect(JSON.stringify(o.o)).not.toMatch(/Knee|Sunita/);
    await rejects(asUser(db, ids.doctor, (tx) => tx.query(`select public.clinic_overview($1, current_date - 7, current_date)`, [ids.clinic])), /Not permitted/);
    await rejects(asUser(db, ids.other, (tx) => tx.query(`select public.clinic_overview($1, current_date - 7, current_date)`, [ids.clinic])), /Not permitted/);
  });

  it('buckets trends by week and compares branches', async () => {
    const trends = await asUser(db, ids.admin, (tx) =>
      tx.query<{ new_patients: number; consultations_completed: number }>(`select * from public.clinic_trends($1, current_date - 13, current_date, 'week')`, [ids.clinic]),
    );
    expect(trends.rows.length).toBeGreaterThanOrEqual(2);
    expect(trends.rows.reduce((s, r) => s + Number(r.new_patients), 0)).toBe(2);
    expect(trends.rows.reduce((s, r) => s + Number(r.consultations_completed), 0)).toBe(1);
    await rejects(asUser(db, ids.admin, (tx) => tx.query(`select * from public.clinic_trends($1, current_date - 1, current_date, 'hour')`, [ids.clinic])), /Unknown period/);
    const branches = await asUser(db, ids.admin, (tx) => tx.query<{ branch_name: string; collected_paise: number }>(`select * from public.branch_metrics($1, current_date - 30, current_date)`, [ids.clinic]));
    expect(branches.rows).toHaveLength(1);
    expect(Number(branches.rows[0]!.collected_paise)).toBe(30000);
  });
});

describe('doctor workspace', () => {
  it('counts only the doctor’s own work', async () => {
    const d1 = await asUser(db, ids.doctor, (tx) => one<{ o: Record<string, number> }>(tx, `select public.doctor_overview($1) as o`, [ids.clinic]));
    const d2 = await asUser(db, ids.doctor2, (tx) => one<{ o: Record<string, number> }>(tx, `select public.doctor_overview($1) as o`, [ids.clinic]));
    expect(Number(d1.o.completed_today)).toBe(1);
    expect(Number(d2.o.completed_today)).toBe(0);
  });

  it('lists recently viewed patients from the caller’s own views only', async () => {
    await asUser(db, ids.doctor, (tx) => tx.query(`select (public.view_patient($1)).id`, [ids.patient]));
    await asUser(db, ids.admin, (tx) => tx.query(`select (public.view_patient($1)).id`, [ids.patient2]));
    const mine = await asUser(db, ids.doctor, (tx) => tx.query<{ patient_id: string }>(`select patient_id from public.my_recent_patients($1)`, [ids.clinic]));
    expect(mine.rows.map((r) => r.patient_id)).toEqual([ids.patient]);
    // Losing access removes the patient from the list.
    await asOwner(db, (tx) => tx.query(`update public.patients set assigned_doctor_id = $2 where id = $1`, [ids.patient, ids.doctor2]));
    const after = await asUser(db, ids.doctor, (tx) => tx.query(`select patient_id from public.my_recent_patients($1)`, [ids.clinic]));
    expect(after.rows).toHaveLength(0);
    await asOwner(db, (tx) => tx.query(`update public.patients set assigned_doctor_id = $2 where id = $1`, [ids.patient, ids.doctor]));
  });
});

describe('access reviews', () => {
  it('records reviews by user managers and reports last activity', async () => {
    await rejects(asUser(db, ids.doctor, (tx) => tx.query(`insert into public.access_reviews (clinic_id, member_count) values ($1, 4)`, [ids.clinic])), /row-level security/);
    await asUser(db, ids.owner, (tx) => tx.query(`insert into public.access_reviews (clinic_id, member_count, notes) values ($1, 4, 'Quarterly review')`, [ids.clinic]));
    await rejects(asOwner(db, (tx) => tx.query(`delete from public.access_reviews`)), /immutable/);
    const act = await asUser(db, ids.owner, (tx) => tx.query<{ user_id: string; last_activity_at: string | null }>(`select * from public.member_last_activity($1)`, [ids.clinic]));
    expect(act.rows.find((r) => r.user_id === ids.doctor)?.last_activity_at).not.toBeNull();
    await rejects(asUser(db, ids.doctor, (tx) => tx.query(`select * from public.member_last_activity($1)`, [ids.clinic])), /Not permitted/);
  });
});

describe('clinic preferences', () => {
  it('accepts known settings and rejects unknown keys or wrong types', async () => {
    const set = (settings: object) => asUser(db, ids.owner, (tx) => tx.query(`update public.clinics set settings = $2::jsonb where id = $1`, [ids.clinic, JSON.stringify(settings)]));
    await set({ bilingual_labels: true, default_appointment_minutes: 20, prescription_language: 'patient', consultation_sections: { menstrual_history: false } });
    await rejects(set({ theme: 'dark' }), /Unknown clinic setting/);
    await rejects(set({ default_appointment_minutes: 1000 }), /Invalid clinic setting value/);
    await rejects(set({ demo: true }), /managed by the platform/);
  });
});
