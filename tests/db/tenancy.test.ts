/**
 * Phase 4–6 database guarantees: per-command tenant isolation, policy
 * coverage, branch scope, platform boundary, subscriptions, invitations,
 * consents, follow-ups, prescription revisions, documents, refunds and audit.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asOwner, asServiceRole, asUser, createDatabase, createUser, setPlan } from './harness';

let db: PGlite;
type IdKey =
  | 'ownerA' | 'adminA' | 'doctorA' | 'branchAdmin' | 'invitee' | 'ownerB' | 'platform'
  | 'clinicA' | 'clinicB' | 'mainBranch' | 'branch2' | 'patient' | 'patientB' | 'appt' | 'consult' | 'invoice';
const ids = {} as Record<IdKey, string>;

async function one<T>(tx: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  return (await tx.query<T>(sql, params)).rows[0] as T;
}
async function rejects(p: Promise<unknown>, re: RegExp) {
  await expect(p).rejects.toThrow(re);
}

beforeAll(async () => {
  db = await createDatabase();
  ids.ownerA = await createUser(db, 'owner-a@example.test', 'Dr. Asha Kulkarni');
  ids.adminA = await createUser(db, 'admin-a@example.test', 'Rohan Deshpande');
  ids.doctorA = await createUser(db, 'doctor-a@example.test', 'Dr. Meera Joshi');
  ids.branchAdmin = await createUser(db, 'branch-admin@example.test', 'Neha Patil');
  ids.invitee = await createUser(db, 'invitee@example.test', 'Kiran Jadhav');
  ids.ownerB = await createUser(db, 'owner-b@example.test', 'Dr. Kavita Shinde');
  ids.platform = await createUser(db, 'ops@vxora.test', 'Platform Ops');

  ids.clinicA = (await asUser(db, ids.ownerA, (tx) => one<{ id: string }>(tx, `select public.create_clinic('Dhanvantari Ayurveda', 'Pune') as id`))).id;
  ids.clinicB = (await asUser(db, ids.ownerB, (tx) => one<{ id: string }>(tx, `select public.create_clinic('Sahyadri Vaidyashala', 'Nashik') as id`))).id;
  await setPlan(db, ids.clinicA, 'multi_branch');

  ids.mainBranch = (await asOwner(db, (tx) => one<{ id: string }>(tx, `select id from public.branches where clinic_id = $1`, [ids.clinicA]))).id;
  ids.branch2 = (await asUser(db, ids.ownerA, (tx) =>
    one<{ id: string }>(tx, `insert into public.branches (clinic_id, name, city) values ($1, 'Kothrud', 'Pune') returning id`, [ids.clinicA]),
  )).id;

  await asOwner(db, async (tx) => {
    await tx.query(
      `insert into public.clinic_members (clinic_id, user_id, roles, default_branch_id, accepted_at) values
        ($1, $2, '{admin}', $5, now()), ($1, $3, '{doctor}', $5, now()), ($1, $4, '{admin}', $6, now())`,
      [ids.clinicA, ids.adminA, ids.doctorA, ids.branchAdmin, ids.mainBranch, ids.branch2],
    );
    await tx.query(`insert into public.clinic_members (clinic_id, user_id, roles, status) values ($1, $2, '{doctor}', 'invited')`, [ids.clinicA, ids.invitee]);
    await tx.query(`insert into public.platform_admins (user_id, role) values ($1, 'owner')`, [ids.platform]);
  });
  const branchMember = await asOwner(db, (tx) => one<{ id: string }>(tx, `select id from public.clinic_members where user_id = $1`, [ids.branchAdmin]));
  await asUser(db, ids.ownerA, (tx) =>
    tx.query(`insert into public.member_branches (member_id, clinic_id, branch_id) values ($1, $2, $3)`, [branchMember.id, ids.clinicA, ids.branch2]),
  );

  ids.patient = (await asUser(db, ids.adminA, (tx) =>
    one<{ id: string }>(
      tx,
      `insert into public.patients (clinic_id, first_name, last_name, assigned_doctor_id, phone, occupation)
       values ($1, 'Sunita', 'Pawar', $2, '+91 98220 11111', 'Teacher') returning id`,
      [ids.clinicA, ids.doctorA],
    ),
  )).id;
  ids.patientB = (await asUser(db, ids.ownerB, (tx) => one<{ id: string }>(tx, `insert into public.patients (clinic_id, first_name) values ($1, 'Lata') returning id`, [ids.clinicB]))).id;

  ids.appt = (await asUser(db, ids.adminA, (tx) =>
    one<{ id: string }>(
      tx,
      `insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at, source)
       values ($1, $2, $3, '2026-11-02 10:00+05:30', '2026-11-02 10:30+05:30', 'phone') returning id`,
      [ids.clinicA, ids.patient, ids.doctorA],
    ),
  )).id;
  ids.consult = (await asUser(db, ids.doctorA, (tx) =>
    one<{ id: string }>(tx, `select public.save_consultation($1, null, $2::jsonb, $3::jsonb) as id`, [
      ids.clinicA,
      JSON.stringify({ patient_id: ids.patient, appointment_id: ids.appt, chief_complaint: 'Knee pain', follow_up_date: '2026-11-20' }),
      JSON.stringify({ ama: 'mild', vata_score: 7, nidra: 'Disturbed, 5 h', dinacharya: 'Late dinner' }),
    ]),
  )).id;
  ids.invoice = (await asUser(db, ids.adminA, (tx) =>
    one<{ id: string }>(tx, `select (public.create_invoice($1, $2, '[{"description":"Consultation","quantity":1,"unit_price_paise":50000}]'::jsonb)).id`, [ids.clinicA, ids.patient]),
  )).id;
});

// ---------------------------------------------------------------------------
describe('policy coverage (static checks on the catalog)', () => {
  it('enables RLS on every public table', async () => {
    const r = await asOwner(db, (tx) =>
      tx.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
      ),
    );
    expect(r.rows).toEqual([]);
  });

  it('has no policy that allows access merely for being authenticated, except reference data', async () => {
    const r = await asOwner(db, (tx) =>
      tx.query<{ tablename: string; policyname: string }>(
        `select tablename, policyname from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true')`,
      ),
    );
    expect(r.rows.map((x) => x.tablename).sort()).toEqual(['permissions', 'role_permissions']);
  });

  it('grants DELETE to API users only where hard deletes are intended', async () => {
    const r = await asOwner(db, (tx) =>
      tx.query<{ table_name: string }>(
        `select table_name from information_schema.role_table_grants
         where table_schema = 'public' and grantee in ('authenticated', 'anon') and privilege_type = 'DELETE' order by 1`,
      ),
    );
    expect(r.rows.map((x) => x.table_name)).toEqual(['member_branches', 'prescription_items']);
  });

  it('gives anon no table privileges at all', async () => {
    const r = await asOwner(db, (tx) =>
      tx.query(`select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'`),
    );
    expect(r.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('cross-tenant isolation per command', () => {
  const tables = [
    'patients', 'appointments', 'consultations', 'ayurvedic_examinations', 'invoices', 'invoice_items', 'branches',
    'clinic_members', 'follow_ups', 'audit_events', 'tenant_subscriptions', 'clinics',
  ];

  for (const table of tables) {
    it(`${table}: another clinic's owner can SELECT/UPDATE/DELETE nothing`, async () => {
      const col = table === 'clinics' ? 'id' : 'clinic_id';
      const seen = await asUser(db, ids.ownerB, (tx) => tx.query(`select 1 from public.${table} where ${col} = $1`, [ids.clinicA]));
      expect(seen.rows).toHaveLength(0);

      const upd = asUser(db, ids.ownerB, (tx) => tx.query(`update public.${table} set ${col} = ${col} where ${col} = $1`, [ids.clinicA]));
      await upd.then(
        (r) => expect(r.affectedRows ?? 0).toBe(0),
        (e: Error) => expect(e.message).toMatch(/permission denied/),
      );

      const del = asUser(db, ids.ownerB, (tx) => tx.query(`delete from public.${table} where ${col} = $1`, [ids.clinicA]));
      await del.then(
        (r) => expect(r.affectedRows ?? 0).toBe(0),
        (e: Error) => expect(e.message).toMatch(/permission denied/),
      );
    });
  }

  it('INSERT into another clinic is rejected for each writable table', async () => {
    await rejects(asUser(db, ids.ownerB, (tx) => tx.query(`insert into public.patients (clinic_id, first_name) values ($1, 'X')`, [ids.clinicA])), /row-level security/);
    await rejects(asUser(db, ids.ownerB, (tx) => tx.query(`insert into public.branches (clinic_id, name) values ($1, 'X branch')`, [ids.clinicA])), /row-level security/);
    await rejects(
      asUser(db, ids.ownerB, (tx) =>
        tx.query(
          `insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at) values ($1, $2, $3, now(), now() + interval '15 min')`,
          [ids.clinicA, ids.patient, ids.doctorA],
        ),
      ),
      /row-level security/,
    );
    await rejects(
      asUser(db, ids.ownerB, (tx) => tx.query(`insert into public.patient_consents (clinic_id, patient_id, consent_type, method, policy_version) values ($1, $2, 'treatment', 'written', 'v1')`, [ids.clinicA, ids.patient])),
      /row-level security/,
    );
    await rejects(
      asUser(db, ids.ownerB, (tx) => tx.query(`select public.create_invoice($1, $2, '[{"description":"x","quantity":1,"unit_price_paise":1}]'::jsonb)`, [ids.clinicA, ids.patient])),
      /Not permitted/,
    );
  });

  it('cannot move a record to another clinic (IDOR via clinic_id)', async () => {
    await rejects(
      asUser(db, ids.ownerB, (tx) => tx.query(`update public.patients set clinic_id = $1 where id = $2`, [ids.clinicA, ids.patientB])),
      /clinic_id cannot be changed|row-level security/,
    );
  });

  it('own-clinic admins cannot hard-delete records', async () => {
    for (const table of ['patients', 'appointments', 'invoices', 'payments', 'audit_events', 'patient_documents', 'refunds']) {
      await rejects(asUser(db, ids.adminA, (tx) => tx.query(`delete from public.${table} where clinic_id = $1`, [ids.clinicA])), /permission denied/);
    }
  });
});

// ---------------------------------------------------------------------------
describe('branch scope', () => {
  it('a branch-restricted admin sees only their branch schedule', async () => {
    const r = await asUser(db, ids.branchAdmin, (tx) => tx.query(`select id from public.appointments`));
    expect(r.rows).toHaveLength(0);
    const all = await asUser(db, ids.adminA, (tx) => tx.query(`select id from public.appointments`));
    expect(all.rows).toHaveLength(1);
  });

  it('cannot book or bill into a branch outside their scope', async () => {
    await rejects(
      asUser(db, ids.branchAdmin, (tx) =>
        tx.query(
          `insert into public.appointments (clinic_id, branch_id, patient_id, doctor_id, starts_at, ends_at) values ($1, $2, $3, $4, '2026-11-03 10:00+05:30', '2026-11-03 10:30+05:30')`,
          [ids.clinicA, ids.mainBranch, ids.patient, ids.doctorA],
        ),
      ),
      /row-level security/,
    );
    await rejects(asUser(db, ids.branchAdmin, (tx) => tx.query(`select public.set_appointment_status($1, 'checked_in')`, [ids.appt])), /Not permitted/);
    const invoices = await asUser(db, ids.branchAdmin, (tx) => tx.query(`select id from public.invoices`));
    expect(invoices.rows).toHaveLength(0);
  });

  it('defaults new appointments to the member branch', async () => {
    const r = await asUser(db, ids.branchAdmin, (tx) =>
      one<{ branch_id: string }>(
        tx,
        `insert into public.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at) values ($1, $2, $3, '2026-11-04 10:00+05:30', '2026-11-04 10:30+05:30') returning branch_id`,
        [ids.clinicA, ids.patient, ids.doctorA],
      ),
    );
    expect(r.branch_id).toBe(ids.branch2);
  });
});

// ---------------------------------------------------------------------------
describe('platform boundary', () => {
  it('a platform admin gets metadata only, never patient data', async () => {
    const clinics = await asUser(db, ids.platform, (tx) => tx.query<{ name: string; plan_code: string }>(`select name, plan_code from public.platform_list_clinics()`));
    expect(clinics.rows.map((c) => c.name).sort()).toEqual(['Dhanvantari Ayurveda', 'Sahyadri Vaidyashala']);
    const patients = await asUser(db, ids.platform, (tx) => tx.query<{ id: string }>(`select id from public.patients`));
    expect(patients.rows).toHaveLength(0);
    const consults = await asUser(db, ids.platform, (tx) => tx.query(`select id from public.consultations`));
    expect(consults.rows).toHaveLength(0);
  });

  it('clinic admins are not platform admins', async () => {
    await rejects(asUser(db, ids.ownerA, (tx) => tx.query(`select * from public.platform_list_clinics()`)), /Not permitted/);
    await rejects(asUser(db, ids.ownerA, (tx) => tx.query(`select public.platform_assign_plan($1, 'multi_branch', 'active')`, [ids.clinicB])), /Not permitted/);
    await rejects(asUser(db, ids.ownerA, (tx) => tx.query(`insert into public.platform_admins (user_id) values ($1)`, [ids.ownerA])), /permission denied/);
    await rejects(asUser(db, ids.ownerA, (tx) => tx.query(`update public.clinics set status = 'closed' where id = $1`, [ids.clinicA])), /managed by the platform/);
  });

  it('suspending a clinic blocks its members but still lets them see why', async () => {
    await asUser(db, ids.platform, (tx) => tx.query(`select public.platform_set_clinic_status($1, 'suspended', 'Unpaid invoice')`, [ids.clinicB]));
    const patients = await asUser(db, ids.ownerB, (tx) => tx.query<{ id: string }>(`select id from public.patients`));
    expect(patients.rows).toHaveLength(0);
    const perms = await asUser(db, ids.ownerB, (tx) => tx.query(`select public.my_permissions($1)`, [ids.clinicB]));
    expect(perms.rows).toHaveLength(0);
    const clinic = await asUser(db, ids.ownerB, (tx) => one<{ status: string }>(tx, `select status from public.clinics where id = $1`, [ids.clinicB]));
    expect(clinic.status).toBe('suspended');
    await asUser(db, ids.platform, (tx) => tx.query(`select public.platform_set_clinic_status($1, 'active', null)`, [ids.clinicB]));
    expect((await asUser(db, ids.ownerB, (tx) => tx.query(`select id from public.patients`))).rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('subscriptions and plan limits', () => {
  it('new clinics start on a trial; only admins can read it and nobody can write it from the client', async () => {
    const sub = await asUser(db, ids.ownerB, (tx) => one<{ status: string }>(tx, `select status from public.tenant_subscriptions where clinic_id = $1`, [ids.clinicB]));
    expect(sub.status).toBe('trialing');
    const asDoctor = await asUser(db, ids.doctorA, (tx) => tx.query(`select id from public.tenant_subscriptions`));
    expect(asDoctor.rows).toHaveLength(0);
    await rejects(asUser(db, ids.ownerB, (tx) => tx.query(`update public.tenant_subscriptions set status = 'active'`)), /permission denied/);
  });

  it('enforces branch limits from the plan', async () => {
    await rejects(
      asUser(db, ids.ownerB, (tx) => tx.query(`insert into public.branches (clinic_id, name) values ($1, 'Second')`, [ids.clinicB])),
      /plan allows up to 1 branches/,
    );
  });
});

// ---------------------------------------------------------------------------
describe('invitations', () => {
  it('an invited member has no access until they accept', async () => {
    expect((await asUser(db, ids.invitee, (tx) => tx.query(`select public.my_permissions($1)`, [ids.clinicA]))).rows).toHaveLength(0);
    const own = await asUser(db, ids.invitee, (tx) => one<{ status: string }>(tx, `select status from public.clinic_members where user_id = $1`, [ids.invitee]));
    expect(own.status).toBe('invited');
    await asUser(db, ids.invitee, (tx) => tx.query(`select public.accept_invitation($1)`, [ids.clinicA]));
    expect((await asUser(db, ids.invitee, (tx) => tx.query(`select public.my_permissions($1)`, [ids.clinicA]))).rows.length).toBeGreaterThan(0);
  });

  it('records role changes in the audit trail without personal data', async () => {
    await asUser(db, ids.ownerA, (tx) => tx.query(`update public.clinic_members set roles = '{doctor,admin}' where user_id = $1`, [ids.invitee]));
    const ev = await asUser(db, ids.ownerA, (tx) =>
      one<{ metadata: { roles_before: string[]; roles_after: string[] } }>(
        tx,
        `select metadata from public.audit_events where event_type = 'clinic_members.update' and metadata ? 'roles_after' order by id desc limit 1`,
      ),
    );
    expect(ev.metadata.roles_before).toEqual(['doctor']);
    expect(ev.metadata.roles_after).toEqual(['doctor', 'admin']);
  });
});

// ---------------------------------------------------------------------------
describe('patient consent', () => {
  it('records consent, allows one active per type, and only permits withdrawal', async () => {
    const c = await asUser(db, ids.adminA, (tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.patient_consents (clinic_id, patient_id, consent_type, method, policy_version) values ($1, $2, 'sms_reminders', 'written', '2026-10') returning id`,
        [ids.clinicA, ids.patient],
      ),
    );
    await rejects(
      asUser(db, ids.adminA, (tx) =>
        tx.query(`insert into public.patient_consents (clinic_id, patient_id, consent_type, method, policy_version) values ($1, $2, 'sms_reminders', 'verbal', '2026-10')`, [ids.clinicA, ids.patient]),
      ),
      /duplicate key|already exists/,
    );
    await rejects(asUser(db, ids.adminA, (tx) => tx.query(`update public.patient_consents set method = 'verbal' where id = $1`, [c.id])), /permission denied/);
    await asUser(db, ids.adminA, (tx) => tx.query(`update public.patient_consents set status = 'withdrawn' where id = $1`, [c.id]));
    const row = await asUser(db, ids.adminA, (tx) => one<{ withdrawn_at: string | null }>(tx, `select withdrawn_at from public.patient_consents where id = $1`, [c.id]));
    expect(row.withdrawn_at).not.toBeNull();
    await rejects(asUser(db, ids.adminA, (tx) => tx.query(`update public.patient_consents set status = 'granted' where id = $1`, [c.id])), /cannot be changed/);
  });
});

// ---------------------------------------------------------------------------
describe('clinical records', () => {
  it('stores the extended Ayurvedic examination', async () => {
    const e = await asUser(db, ids.doctorA, (tx) => one<{ ama: string; vata_score: number }>(tx, `select ama, vata_score from public.ayurvedic_examinations where consultation_id = $1`, [ids.consult]));
    expect(e).toEqual({ ama: 'mild', vata_score: 7 });
  });

  it('validates clinic-configured examination fields', async () => {
    await asUser(db, ids.ownerA, (tx) =>
      tx.query(
        `insert into public.exam_field_definitions (clinic_id, key, label_en, field_type, options) values
          ($1, 'sweat', 'Sweda', 'select', '["normal","excess","scanty"]'), ($1, 'abdominal_girth', 'Abdominal girth', 'number', null)`,
        [ids.clinicA],
      ),
    );
    const save = (fields: object) =>
      asUser(db, ids.doctorA, (tx) =>
        tx.query(`select public.save_consultation($1, $2, $3::jsonb, $4::jsonb)`, [
          ids.clinicA,
          ids.consult,
          JSON.stringify({ patient_id: ids.patient, chief_complaint: 'Knee pain', follow_up_date: '2026-11-20' }),
          JSON.stringify({ custom_fields: fields }),
        ]),
      );
    await save({ sweat: 'excess', abdominal_girth: 92 });
    await rejects(save({ sweat: 'lots' }), /Invalid value for examination field/);
    await rejects(save({ made_up: 1 }), /Unknown examination field/);
    await rejects(save({ abdominal_girth: 'ninety' }), /Invalid value/);
  });

  it('finalizing creates a follow-up the front desk can book, without exposing notes', async () => {
    await asUser(db, ids.doctorA, (tx) => tx.query(`select public.finalize_consultation($1)`, [ids.consult]));
    const fu = await asUser(db, ids.adminA, (tx) => one<{ id: string; due_date: string; status: string }>(tx, `select id, due_date::text, status from public.follow_ups where consultation_id = $1`, [ids.consult]));
    expect(fu).toMatchObject({ due_date: '2026-11-20', status: 'pending' });
    expect((await asUser(db, ids.adminA, (tx) => tx.query(`select id from public.consultations`))).rows).toHaveLength(0);
    const appt = await asUser(db, ids.adminA, (tx) =>
      one<{ id: string }>(tx, `select public.book_follow_up($1, '2026-11-20 11:00+05:30', '2026-11-20 11:30+05:30') as id`, [fu.id]),
    );
    const after = await asUser(db, ids.adminA, (tx) => one<{ status: string; appointment_id: string }>(tx, `select status, appointment_id from public.follow_ups where id = $1`, [fu.id]));
    expect(after).toEqual({ status: 'booked', appointment_id: appt.id });
    const src = await asUser(db, ids.adminA, (tx) => one<{ source: string; type: string }>(tx, `select source, type from public.appointments where id = $1`, [appt.id]));
    expect(src).toEqual({ source: 'follow_up', type: 'follow_up' });
  });
});

// ---------------------------------------------------------------------------
describe('prescription revisions and templates', () => {
  let rx: string;

  it('issuing stores an immutable revision snapshot', async () => {
    rx = (await asUser(db, ids.doctorA, (tx) =>
      one<{ id: string }>(tx, `select public.save_prescription_draft($1, null, $2, $3, $4::jsonb, $5::jsonb) as id`, [
        ids.clinicA,
        ids.patient,
        ids.consult,
        JSON.stringify({ language: 'mr', patient_instructions: 'Take with warm water', follow_up_date: '2026-11-20' }),
        JSON.stringify([{ medicine_name: 'Yogaraj Guggulu', form: 'vati', route: 'oral', dose: '2 tablets', quantity: '60', frequency: 'Twice daily', instructions_en: 'After food', instructions_mr: 'जेवणानंतर' }]),
      ]),
    )).id;
    await asUser(db, ids.doctorA, (tx) => tx.query(`select public.issue_prescription($1, true)`, [rx]));
    const rev = await asUser(db, ids.doctorA, (tx) =>
      one<{ revision_number: number; snapshot: { items: { instructions_mr: string }[] } }>(tx, `select revision_number, snapshot from public.prescription_revisions where prescription_id = $1`, [rx]),
    );
    expect(rev.revision_number).toBe(1);
    expect(rev.snapshot.items[0]!.instructions_mr).toBe('जेवणानंतर');
    await rejects(asOwner(db, (tx) => tx.query(`update public.prescription_revisions set revision_reason = 'x'`)), /immutable/);
    await rejects(asOwner(db, (tx) => tx.query(`delete from public.prescription_revisions`)), /immutable/);
  });

  it('revising keeps the number, requires a reason and produces revision 2 on re-issue', async () => {
    await rejects(asUser(db, ids.doctorA, (tx) => tx.query(`select public.revise_prescription($1, '')`, [rx])), /reason is required/);
    await asUser(db, ids.doctorA, (tx) => tx.query(`select public.revise_prescription($1, 'Dose adjusted')`, [rx]));
    await asUser(db, ids.doctorA, (tx) =>
      tx.query(`select public.save_prescription_draft($1, $2, $3, $4, '{}'::jsonb, $5::jsonb)`, [
        ids.clinicA, rx, ids.patient, ids.consult,
        JSON.stringify([{ medicine_name: 'Yogaraj Guggulu', dose: '1 tablet', frequency: 'Twice daily' }]),
      ]),
    );
    const issued = await asUser(db, ids.doctorA, (tx) =>
      one<{ prescription_no: string; revision_number: number }>(tx, `select (r).prescription_no, (r).revision_number from (select public.issue_prescription($1, true) r) s`, [rx]),
    );
    expect(issued.revision_number).toBe(2);
    expect(issued.prescription_no).toMatch(/^RX-\d{4}-000001$/);
    const revs = await asUser(db, ids.doctorA, (tx) => tx.query<{ revision_number: number }>(`select revision_number from public.prescription_revisions where prescription_id = $1 order by 1`, [rx]));
    expect(revs.rows.map((r) => r.revision_number)).toEqual([1, 2]);
  });

  it('templates are private unless shared and must be complete', async () => {
    await asUser(db, ids.doctorA, (tx) =>
      tx.query(`insert into public.prescription_templates (clinic_id, name, items) values ($1, 'Sandhigata Vata — basic', $2::jsonb)`, [
        ids.clinicA,
        JSON.stringify([{ medicine_name: 'Yogaraj Guggulu', dose: '2 tablets', frequency: 'Twice daily' }]),
      ]),
    );
    expect((await asUser(db, ids.ownerA, (tx) => tx.query(`select id from public.prescription_templates`))).rows).toHaveLength(0);
    await asUser(db, ids.doctorA, (tx) => tx.query(`update public.prescription_templates set is_shared = true`));
    expect((await asUser(db, ids.ownerA, (tx) => tx.query(`select id from public.prescription_templates`))).rows).toHaveLength(1);
    await rejects(
      asUser(db, ids.doctorA, (tx) => tx.query(`insert into public.prescription_templates (clinic_id, name, items) values ($1, 'Broken', '[{"medicine_name":"X"}]'::jsonb)`, [ids.clinicA])),
      /needs a medicine, dose and frequency/,
    );
  });
});

// ---------------------------------------------------------------------------
describe('patient documents', () => {
  it('requires the object to exist before confirming, and hides soft-deleted documents', async () => {
    const d = await asUser(db, ids.doctorA, (tx) =>
      one<{ id: string; storage_path: string }>(
        tx,
        `insert into public.patient_documents (clinic_id, patient_id, title, file_name, mime_type, size_bytes, category) values ($1, $2, 'CBC', 'cbc.pdf', 'application/pdf', 4096, 'lab_report') returning id, storage_path`,
        [ids.clinicA, ids.patient],
      ),
    );
    expect(d.storage_path).toBe(`${ids.clinicA}/patients/${ids.patient}/${d.id}.pdf`);
    await rejects(asUser(db, ids.doctorA, (tx) => tx.query(`select public.confirm_document_upload($1)`, [d.id])), /has not been uploaded/);
    await asUser(db, ids.doctorA, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('clinic-files', $1)`, [d.storage_path]));
    await asUser(db, ids.doctorA, (tx) => tx.query(`select public.confirm_document_upload($1)`, [d.id]));
    await rejects(asUser(db, ids.doctorA, (tx) => tx.query(`update public.patient_documents set title = 'x' where id = $1`, [d.id])), /permission denied/);
    expect((await asUser(db, ids.adminA, (tx) => tx.query(`select id from public.patient_documents`))).rows).toHaveLength(0);
    await asUser(db, ids.doctorA, (tx) => tx.query(`select public.delete_document($1, 'Wrong patient')`, [d.id]));
    expect((await asUser(db, ids.doctorA, (tx) => tx.query(`select id from public.patient_documents where id = $1`, [d.id]))).rows).toHaveLength(0);
  });

  it('logs document access only through the trusted server path', async () => {
    const d = await asOwner(db, (tx) => one<{ id: string }>(tx, `select id from public.patient_documents limit 1`));
    await rejects(asUser(db, ids.doctorA, (tx) => tx.query(`select public.log_document_access($1, $2)`, [d.id, ids.doctorA])), /permission denied/);
    await asServiceRole(db, (tx) => tx.query(`select public.log_document_access($1, $2)`, [d.id, ids.doctorA]));
    const ev = await asUser(db, ids.ownerA, (tx) => tx.query(`select id from public.audit_events where event_type = 'patient_documents.accessed'`));
    expect(ev.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('payments, receipts and refunds', () => {
  it('numbers receipts, records refunds within the paid amount and marks fully refunded invoices', async () => {
    const pay = await asUser(db, ids.adminA, (tx) =>
      one<{ receipt_no: string; id: string }>(tx, `select (p).receipt_no, (p).id from (select public.record_payment($1, 50000, 'upi') p) s`, [ids.invoice]),
    );
    expect(pay.receipt_no).toMatch(/^RCPT-\d{4}-000001$/);
    await rejects(asUser(db, ids.doctorA, (tx) => tx.query(`select public.record_refund($1, 100, 'cash', 'x')`, [ids.invoice])), /Not permitted/);
    await rejects(asUser(db, ids.adminA, (tx) => tx.query(`select public.record_refund($1, 60000, 'cash', 'Overcharged')`, [ids.invoice])), /exceeds the amount paid/);
    await rejects(asUser(db, ids.adminA, (tx) => tx.query(`select public.record_refund($1, 100, 'cash', '  ')`, [ids.invoice])), /reason is required/);
    await asUser(db, ids.adminA, (tx) => tx.query(`select public.record_refund($1, 20000, 'upi', 'Session not delivered', $2)`, [ids.invoice, pay.id]));
    let inv = await asUser(db, ids.adminA, (tx) => one<{ status: string; amount_refunded_paise: number }>(tx, `select status, amount_refunded_paise from public.invoices where id = $1`, [ids.invoice]));
    expect(inv).toEqual({ status: 'paid', amount_refunded_paise: 20000 });
    await asUser(db, ids.adminA, (tx) => tx.query(`select public.record_refund($1, 30000, 'upi', 'Treatment cancelled')`, [ids.invoice]));
    inv = await asUser(db, ids.adminA, (tx) => one<{ status: string; amount_refunded_paise: number }>(tx, `select status, amount_refunded_paise from public.invoices where id = $1`, [ids.invoice]));
    expect(inv.status).toBe('refunded');
    await rejects(asOwner(db, (tx) => tx.query(`update public.refunds set amount_paise = 1`)), /immutable/);
  });

  it('keeps cached invoice totals equal to the underlying payment and refund rows', async () => {
    const r = await asOwner(db, (tx) =>
      tx.query(
        `select i.id from public.invoices i
         where i.amount_paid_paise <> coalesce((select sum(amount_paise) from public.payments p where p.invoice_id = i.id), 0)
            or i.amount_refunded_paise <> coalesce((select sum(amount_paise) from public.refunds r where r.invoice_id = i.id), 0)`,
      ),
    );
    expect(r.rows).toEqual([]);
  });

  it('reports net collections in the clinic time zone', async () => {
    const s = await asUser(db, ids.adminA, (tx) => one<{ s: { collected_this_month_paise: number } }>(tx, `select public.dashboard_summary($1) as s`, [ids.clinicA]));
    expect(Number(s.s.collected_this_month_paise)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('audit events', () => {
  it('records patient views once per 10 minutes', async () => {
    await asUser(db, ids.doctorA, (tx) => tx.query(`select (public.view_patient($1)).id`, [ids.patient]));
    await asUser(db, ids.doctorA, (tx) => tx.query(`select (public.view_patient($1)).id`, [ids.patient]));
    const ev = await asUser(db, ids.ownerA, (tx) => tx.query(`select id from public.audit_events where event_type = 'patients.viewed' and actor_id = $1`, [ids.doctorA]));
    expect(ev.rows).toHaveLength(1);
    await rejects(asUser(db, ids.ownerB, (tx) => tx.query(`select public.view_patient($1)`, [ids.patient])), /could not be found/);
  });

  it('is append-only, even for the database owner', async () => {
    await rejects(asOwner(db, (tx) => tx.query(`update public.audit_events set event_type = 'x.y'`)), /cannot be modified/);
    await rejects(asOwner(db, (tx) => tx.query(`delete from public.audit_events`)), /cannot be modified/);
  });

  it('never copies personal or clinical values into audit records', async () => {
    const all = await asOwner(db, (tx) => tx.query(`select * from public.audit_events`));
    const dump = JSON.stringify(all.rows);
    for (const secret of ['Sunita', 'Pawar', '98220', 'Knee pain', 'Teacher', 'Yogaraj', 'Session not delivered']) {
      expect(dump).not.toContain(secret);
    }
  });

  it('purges expired events only via the service role', async () => {
    await rejects(asUser(db, ids.ownerA, (tx) => tx.query(`select public.purge_expired_audit_events()`)), /permission denied/);
    const n = await asServiceRole(db, (tx) => one<{ n: number }>(tx, `select public.purge_expired_audit_events() as n`));
    expect(Number(n.n)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('clinic time zone', () => {
  it('rejects unknown time zones and uses the configured one for calendar dates', async () => {
    await rejects(asUser(db, ids.ownerA, (tx) => tx.query(`update public.clinics set timezone = 'Mars/Olympus' where id = $1`, [ids.clinicA])), /Unknown time zone/);
    await asUser(db, ids.ownerA, (tx) => tx.query(`update public.clinics set timezone = 'Asia/Dubai' where id = $1`, [ids.clinicA]));
    const r = await asUser(db, ids.ownerA, (tx) =>
      one<{ ok: boolean }>(tx, `select private.clinic_today($1) = (now() at time zone 'Asia/Dubai')::date as ok`, [ids.clinicA]),
    );
    expect(r.ok).toBe(true);
  });
});
