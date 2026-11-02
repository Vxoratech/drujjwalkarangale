/**
 * Phase 10–12 security guarantees.
 *
 * 1. Cross-tenant attacks: a fully privileged owner of clinic B tries every
 *    route (table reads/writes, RPCs, storage) to another clinic's patient,
 *    appointment, prescription and documents. Every attempt must fail.
 * 2. Idempotent money operations, rate limits, safe filenames, upload purge.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asOwner, asServiceRole, asUser, createDatabase, createUser, setPlan } from './harness';

type IdKey = 'ownerA' | 'doctorA' | 'ownerB' | 'clinicA' | 'clinicB' | 'patientA' | 'patientB' | 'apptA' | 'consultA' | 'rxA' | 'docA' | 'docPath' | 'invoiceA';
const ids = {} as Record<IdKey, string>;
let db: PGlite;

async function one<T>(tx: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  return (await tx.query<T>(sql, params)).rows[0] as T;
}
async function rejects(p: Promise<unknown>, re: RegExp) {
  await expect(p).rejects.toThrow(re);
}
/** Run as clinic B's owner: an attacker with every permission in their own clinic. */
const attacker = <T,>(fn: (tx: PGlite) => Promise<T>) => asUser(db, ids.ownerB, fn);
const DENIED = /row-level security|permission denied|Not permitted|could not be found|not found|foreign key/;

beforeAll(async () => {
  db = await createDatabase();
  ids.ownerA = await createUser(db, 'owner-a@example.test', 'Dr. Asha');
  ids.doctorA = await createUser(db, 'doctor-a@example.test', 'Dr. Meera');
  ids.ownerB = await createUser(db, 'owner-b@example.test', 'Dr. Attacker');
  ids.clinicA = (await asUser(db, ids.ownerA, (tx) => one<{ id: string }>(tx, `select public.create_clinic('Clinic A') as id`))).id;
  ids.clinicB = (await asUser(db, ids.ownerB, (tx) => one<{ id: string }>(tx, `select public.create_clinic('Clinic B') as id`))).id;
  await setPlan(db, ids.clinicA, 'clinic');
  await asOwner(db, (tx) => tx.query(`insert into public.clinic_members (clinic_id, user_id, roles, accepted_at) values ($1, $2, '{doctor}', now())`, [ids.clinicA, ids.doctorA]));

  ids.patientA = (await asUser(db, ids.ownerA, (tx) =>
    one<{ id: string }>(tx, `insert into public.patients (clinic_id, first_name, last_name, assigned_doctor_id) values ($1, 'Sunita', 'Pawar', $2) returning id`, [ids.clinicA, ids.doctorA]),
  )).id;
  ids.patientB = (await attacker((tx) => one<{ id: string }>(tx, `insert into public.patients (clinic_id, first_name) values ($1, 'Lata') returning id`, [ids.clinicB]))).id;
  ids.apptA = (await asUser(db, ids.ownerA, (tx) =>
    one<{ id: string }>(tx, `insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at) values ($1, $2, $3, '2026-11-10 10:00+05:30', '2026-11-10 10:30+05:30') returning id`, [ids.clinicA, ids.patientA, ids.doctorA]),
  )).id;
  ids.consultA = (await asUser(db, ids.doctorA, (tx) =>
    one<{ id: string }>(tx, `select public.save_consultation($1, null, $2::jsonb, '{}'::jsonb) as id`, [ids.clinicA, JSON.stringify({ patient_id: ids.patientA, chief_complaint: 'Knee pain' })]),
  )).id;
  ids.rxA = (await asUser(db, ids.doctorA, (tx) =>
    one<{ id: string }>(tx, `select public.save_prescription_draft($1, null, $2, $3, '{}'::jsonb, '[{"medicine_name":"Yogaraj Guggulu","dose":"2 tablets","frequency":"Twice daily"}]'::jsonb) as id`, [ids.clinicA, ids.patientA, ids.consultA]),
  )).id;
  await asUser(db, ids.doctorA, (tx) => tx.query(`select public.issue_prescription($1, true)`, [ids.rxA]));
  const doc = await asUser(db, ids.doctorA, (tx) =>
    one<{ id: string; storage_path: string }>(tx, `insert into public.patient_documents (clinic_id, patient_id, title, file_name, mime_type, size_bytes) values ($1, $2, 'CBC', 'cbc.pdf', 'application/pdf', 1000) returning id, storage_path`, [ids.clinicA, ids.patientA]),
  );
  ids.docA = doc.id;
  ids.docPath = doc.storage_path;
  await asUser(db, ids.doctorA, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('clinic-files', $1)`, [ids.docPath]));
  await asUser(db, ids.doctorA, (tx) => tx.query(`select public.confirm_document_upload($1)`, [ids.docA]));
  ids.invoiceA = (await asUser(db, ids.ownerA, (tx) =>
    one<{ id: string }>(tx, `select (public.create_invoice($1, $2, '[{"description":"Consultation","quantity":1,"unit_price_paise":50000}]'::jsonb)).id`, [ids.clinicA, ids.patientA]),
  )).id;
});

// ---------------------------------------------------------------------------
describe("cross-tenant access to another clinic's PATIENT fails", () => {
  it('cannot read, open, edit or bill the patient', async () => {
    expect((await attacker((tx) => tx.query(`select id from public.patients where id = $1`, [ids.patientA]))).rows).toHaveLength(0);
    await rejects(attacker((tx) => tx.query(`select public.view_patient($1)`, [ids.patientA])), DENIED);
    expect((await attacker((tx) => tx.query(`update public.patients set first_name = 'X' where id = $1`, [ids.patientA]))).affectedRows ?? 0).toBe(0);
    await rejects(attacker((tx) => tx.query(`delete from public.patients where id = $1`, [ids.patientA])), DENIED);
    await rejects(attacker((tx) => tx.query(`select public.create_invoice($1, $2, '[{"description":"x","quantity":1,"unit_price_paise":1}]'::jsonb)`, [ids.clinicB, ids.patientA])), DENIED);
    await rejects(attacker((tx) => tx.query(`insert into public.patient_consents (clinic_id, patient_id, consent_type, method, policy_version) values ($1, $2, 'treatment', 'verbal', 'v1')`, [ids.clinicB, ids.patientA])), DENIED);
    expect((await attacker((tx) => tx.query(`select * from public.my_recent_patients($1)`, [ids.clinicB]))).rows).toHaveLength(0);
  });

  it('cannot smuggle the patient into its own clinic by claiming its own clinic_id', async () => {
    await rejects(
      attacker((tx) => tx.query(`select public.save_consultation($1, null, $2::jsonb, '{}'::jsonb)`, [ids.clinicB, JSON.stringify({ patient_id: ids.patientA, chief_complaint: 'x' })])),
      DENIED,
    );
    await rejects(
      attacker((tx) =>
        tx.query(`insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at) values ($1, $2, $3, now(), now() + interval '15 min')`, [ids.clinicB, ids.patientA, ids.ownerB]),
      ),
      DENIED,
    );
  });
});

describe("cross-tenant access to another clinic's APPOINTMENT fails", () => {
  it('cannot read, change status, reschedule, cancel or book from it', async () => {
    expect((await attacker((tx) => tx.query(`select id from public.appointments where id = $1`, [ids.apptA]))).rows).toHaveLength(0);
    await rejects(attacker((tx) => tx.query(`select public.set_appointment_status($1, 'cancelled', 'x')`, [ids.apptA])), DENIED);
    expect((await attacker((tx) => tx.query(`update public.appointments set starts_at = starts_at + interval '1 day' where id = $1`, [ids.apptA]))).affectedRows ?? 0).toBe(0);
    await rejects(attacker((tx) => tx.query(`delete from public.appointments where id = $1`, [ids.apptA])), DENIED);
    await rejects(
      attacker((tx) => tx.query(`select public.create_invoice($1, $2, '[{"description":"x","quantity":1,"unit_price_paise":1}]'::jsonb, 0, null, $3)`, [ids.clinicB, ids.patientB, ids.apptA])),
      DENIED,
    );
  });
});

describe("cross-tenant access to another clinic's PRESCRIPTION fails", () => {
  it('cannot read the prescription, its items or its revision history', async () => {
    expect((await attacker((tx) => tx.query(`select id from public.prescriptions where id = $1`, [ids.rxA]))).rows).toHaveLength(0);
    expect((await attacker((tx) => tx.query(`select id from public.prescription_items where prescription_id = $1`, [ids.rxA]))).rows).toHaveLength(0);
    expect((await attacker((tx) => tx.query(`select id from public.prescription_revisions where prescription_id = $1`, [ids.rxA]))).rows).toHaveLength(0);
  });

  it('cannot revise, cancel, re-issue or overwrite it', async () => {
    await rejects(attacker((tx) => tx.query(`select public.revise_prescription($1, 'x')`, [ids.rxA])), DENIED);
    await rejects(attacker((tx) => tx.query(`select public.issue_prescription($1, true)`, [ids.rxA])), DENIED);
    expect((await attacker((tx) => tx.query(`update public.prescriptions set status = 'cancelled' where id = $1`, [ids.rxA]))).affectedRows ?? 0).toBe(0);
    await rejects(attacker((tx) => tx.query(`select public.save_prescription_draft($1, $2, $3, null, '{}'::jsonb, '[]'::jsonb)`, [ids.clinicB, ids.rxA, ids.patientB])), DENIED);
    await rejects(attacker((tx) => tx.query(`delete from public.prescription_items where prescription_id = $1`, [ids.rxA])).then((r) => {
      if ((r.affectedRows ?? 0) === 0) throw new Error('not found');
    }), DENIED);
  });
});

describe("cross-tenant access to another clinic's DOCUMENTS fails", () => {
  it('cannot list, confirm, delete or log access to the document', async () => {
    expect((await attacker((tx) => tx.query(`select id from public.patient_documents where id = $1`, [ids.docA]))).rows).toHaveLength(0);
    await rejects(attacker((tx) => tx.query(`select public.confirm_document_upload($1)`, [ids.docA])), DENIED);
    await rejects(attacker((tx) => tx.query(`select public.delete_document($1, 'x')`, [ids.docA])), DENIED);
    await rejects(attacker((tx) => tx.query(`select public.log_document_access($1, $2)`, [ids.docA, ids.ownerB])), DENIED);
  });

  it('cannot read, overwrite or plant files in the other clinic’s storage folder', async () => {
    expect((await attacker((tx) => tx.query(`select id from storage.objects where name = $1`, [ids.docPath]))).rows).toHaveLength(0);
    await rejects(attacker((tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('clinic-files', $1)`, [ids.docPath])), DENIED);
    await rejects(
      attacker((tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('clinic-files', $1)`, [`${ids.clinicA}/patients/${ids.patientA}/planted.pdf`])),
      DENIED,
    );
    await rejects(
      attacker((tx) =>
        tx.query(`insert into public.patient_documents (clinic_id, patient_id, title, file_name, mime_type, size_bytes) values ($1, $2, 'x', 'x.pdf', 'application/pdf', 10)`, [ids.clinicB, ids.patientA]),
      ),
      DENIED,
    );
    expect((await attacker((tx) => tx.query(`update storage.objects set name = name where name = $1`, [ids.docPath]))).affectedRows ?? 0).toBe(0);
  });

  it('does not expose patient files even to the same clinic’s admin directly', async () => {
    expect((await asUser(db, ids.ownerA, (tx) => tx.query(`select id from storage.objects`))).rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('idempotent money operations', () => {
  const key = '6f1c7e0e-6a7b-4a1e-9a55-0e2d3c4b5a61';

  it('a retried payment with the same key is recorded once', async () => {
    const pay = () => asUser(db, ids.ownerA, (tx) => one<{ id: string }>(tx, `select (public.record_payment($1, 20000, 'upi', 'UTR1', now(), null, $2)).id`, [ids.invoiceA, key]));
    const first = await pay();
    const second = await pay();
    expect(second.id).toBe(first.id);
    const inv = await asUser(db, ids.ownerA, (tx) => one<{ amount_paid_paise: string }>(tx, `select amount_paid_paise from public.invoices where id = $1`, [ids.invoiceA]));
    expect(Number(inv.amount_paid_paise)).toBe(20000);
    await rejects(asUser(db, ids.ownerA, (tx) => tx.query(`select public.record_payment($1, 999, 'upi', null, now(), null, $2)`, [ids.invoiceA, key])), /already used for a different payment/);
  });

  it('a retried invoice and refund with the same key are created once', async () => {
    const invKey = '0b9a8c7d-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
    const make = () =>
      asUser(db, ids.ownerA, (tx) =>
        one<{ id: string }>(tx, `select (public.create_invoice($1, $2, '[{"description":"Taila","quantity":1,"unit_price_paise":18000}]'::jsonb, 0, null, null, null, $3)).id`, [ids.clinicA, ids.patientA, invKey]),
      );
    expect((await make()).id).toBe((await make()).id);
    const refKey = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
    const refund = () => asUser(db, ids.ownerA, (tx) => one<{ id: string }>(tx, `select (public.record_refund($1, 5000, 'upi', 'Overcharged', null, null, $2)).id`, [ids.invoiceA, refKey]));
    expect((await refund()).id).toBe((await refund()).id);
    const inv = await asUser(db, ids.ownerA, (tx) => one<{ amount_refunded_paise: string }>(tx, `select amount_refunded_paise from public.invoices where id = $1`, [ids.invoiceA]));
    expect(Number(inv.amount_refunded_paise)).toBe(5000);
  });

  it('keys are per clinic: another clinic cannot probe or reuse them', async () => {
    await rejects(attacker((tx) => tx.query(`select public.record_payment($1, 20000, 'upi', null, now(), null, $2)`, [ids.invoiceA, key])), DENIED);
  });
});

describe('rate limiting', () => {
  it('allows calls up to the limit within a window, for trusted server code only', async () => {
    const hit = () => asServiceRole(db, (tx) => one<{ ok: boolean }>(tx, `select public.consume_rate_limit('invite:test-user', 2, 3600) as ok`));
    expect((await hit()).ok).toBe(true);
    expect((await hit()).ok).toBe(true);
    expect((await hit()).ok).toBe(false);
    await rejects(asUser(db, ids.ownerA, (tx) => tx.query(`select public.consume_rate_limit('x', 1, 60)`)), /permission denied/);
  });

  it('brakes bulk opening of patient records and audits the refusal', async () => {
    await asOwner(db, (tx) =>
      tx.query(`insert into private.rate_limits (key, window_start, hits) values ($1, to_timestamp(floor(extract(epoch from now()) / 600) * 600), 300)`, [`patient_view:${ids.doctorA}`]),
    );
    const r = await asUser(db, ids.doctorA, (tx) => one<{ id: string | null }>(tx, `select (public.view_patient($1)).id`, [ids.patientA]));
    expect(r.id).toBeNull();
    const ev = await asOwner(db, (tx) => tx.query(`select id from public.audit_events where event_type = 'security.rate_limited' and actor_id = $1`, [ids.doctorA]));
    expect(ev.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('file safety', () => {
  const insertDoc = (fileName: string) =>
    asUser(db, ids.doctorA, (tx) =>
      tx.query(`insert into public.patient_documents (clinic_id, patient_id, title, file_name, mime_type, size_bytes) values ($1, $2, 'x', $3, 'application/pdf', 10)`, [ids.clinicA, ids.patientA, fileName]),
    );

  it('rejects path-like, hidden or control-character filenames, unsupported types and oversize files', async () => {
    await rejects(insertDoc('../../etc/passwd'), /safe_file_name/);
    await rejects(insertDoc('folder\\report.pdf'), /safe_file_name/);
    await rejects(insertDoc('.hidden.pdf'), /safe_file_name/);
    await rejects(insertDoc('line\nbreak.pdf'), /safe_file_name/);
    await insertDoc('Blood report 02-11-2026.pdf');
    await rejects(
      asUser(db, ids.doctorA, (tx) => tx.query(`insert into public.patient_documents (clinic_id, patient_id, title, file_name, mime_type, size_bytes) values ($1, $2, 'x', 'x.exe', 'application/x-msdownload', 10)`, [ids.clinicA, ids.patientA])),
      /mime_type/,
    );
    await rejects(
      asUser(db, ids.doctorA, (tx) => tx.query(`insert into public.patient_documents (clinic_id, patient_id, title, file_name, mime_type, size_bytes) values ($1, $2, 'x', 'x.pdf', 'application/pdf', 20000000)`, [ids.clinicA, ids.patientA])),
      /size_bytes/,
    );
  });

  it('purges abandoned uploads via the service role only and reports their paths', async () => {
    const stale = await asOwner(db, (tx) =>
      one<{ storage_path: string }>(
        tx,
        `insert into public.patient_documents (clinic_id, patient_id, title, file_name, mime_type, size_bytes, uploaded_by, created_at)
         values ($1, $2, 'stale', 'stale.pdf', 'application/pdf', 10, $3, now() - interval '2 days') returning storage_path`,
        [ids.clinicA, ids.patientA, ids.doctorA],
      ),
    );
    await rejects(asUser(db, ids.ownerA, (tx) => tx.query(`select * from public.purge_abandoned_uploads()`)), /permission denied/);
    const purged = await asServiceRole(db, (tx) => tx.query<{ storage_path: string }>(`select * from public.purge_abandoned_uploads()`));
    expect(purged.rows.map((r) => r.storage_path)).toEqual([stale.storage_path]);
    // Confirmed documents are never purged.
    expect((await asUser(db, ids.doctorA, (tx) => tx.query(`select id from public.patient_documents where id = $1`, [ids.docA]))).rows).toHaveLength(1);
  });
});
