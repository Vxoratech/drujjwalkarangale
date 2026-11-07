import { beforeAll, describe, expect, it } from 'vitest';
import { asUser } from './harness';
import { book, consult, count, createWorld, expectError, registerPatient, type World } from './world';

let w: World;
beforeAll(async () => {
  w = await createWorld();
});

describe('central patient registration', () => {
  it('assigns one patient ID and flags likely duplicates before registering', async () => {
    const r = w.receptionist.userId;
    const first = await registerPatient(w.db, r, w.main, 'Anjali', { last_name: 'Deshmukh', phone: '+91 98220 11111', date_of_birth: '1985-04-12' });
    const code = await asUser(w.db, r, async (tx) => (await tx.query<{ patient_code: string }>(`select patient_code from public.patients where id = $1`, [first])).rows[0]!.patient_code);
    expect(code).toMatch(/^P-\d{6}$/);

    // Same phone, different spelling, at another branch.
    const dupes = await asUser(w.db, w.dhanoriReception.userId, async (tx) =>
      (await tx.query<{ patient_id: string; match_reasons: string[] }>(`select * from public.find_possible_duplicates('Anjli', 'Deshmukh', '9822011111', null, null)`)).rows,
    );
    expect(dupes[0]).toMatchObject({ patient_id: first });
    expect(dupes[0]!.match_reasons).toContain('phone');

    await expectError(
      () => asUser(w.db, w.dhanoriReception.userId, (tx) => tx.query(`select public.register_patient($1::jsonb, $2)`, [JSON.stringify({ first_name: 'Anjli', last_name: 'Deshmukh', phone: '9822011111' }), w.dhanori])),
      'P0003',
    );
    // A genuinely different person with a reviewed warning is allowed, and the review is audited.
    const second = await asUser(w.db, w.dhanoriReception.userId, async (tx) =>
      (await tx.query<{ id: string; duplicate_reviewed: boolean }>(`select id, duplicate_reviewed from public.register_patient($1::jsonb, $2, true)`, [JSON.stringify({ first_name: 'Anjali', last_name: 'Deshmukh', phone: '9822099999', date_of_birth: '1990-01-01' }), w.dhanori])).rows[0]!,
    );
    expect(second.duplicate_reviewed).toBe(true);
    expect(await count(w.db, w.admin, `select 1 from public.audit_events where event_type = 'patients.duplicate_reviewed' and entity_id = $1`, [second.id])).toBe(1);
  });

  it('keeps one profile when a patient visits several branches', async () => {
    const p = await registerPatient(w.db, w.receptionist.userId, w.main, 'Vasant');
    const mainVisit = await book(w.db, w.receptionist.userId, w.main, p);
    const dhanoriVisit = await book(w.db, w.dhanoriReception.userId, w.dhanori, p);
    await consult(w.db, w.doctor, w.main, p, mainVisit);
    await consult(w.db, w.doctor, w.dhanori, p, dhanoriVisit);
    const visits = await asUser(w.db, w.doctor, async (tx) =>
      (await tx.query<{ code: string }>(`select b.code from public.consultations c join public.clinic_branches b on b.id = c.branch_id where c.patient_id = $1 order by b.code`, [p])).rows.map((r) => r.code),
    );
    expect(visits).toEqual(['DHN', 'MAIN']);
    expect(await count(w.db, w.doctor, `select 1 from public.patients where first_name = 'Vasant'`)).toBe(1);
  });

  it('only registers at branches the user works at', async () => {
    await expectError(() => registerPatient(w.db, w.receptionist.userId, w.dhanori, 'Elsewhere'), '42501');
  });
});

describe('scheduling', () => {
  it('never double-books the doctor, across branches', async () => {
    const p = await registerPatient(w.db, w.receptionist.userId, w.main, 'Overlap');
    const at = new Date(Date.UTC(2026, 10, 20, 5, 0));
    await book(w.db, w.receptionist.userId, w.main, p, at);
    await expectError(() => book(w.db, w.dhanoriReception.userId, w.dhanori, p, new Date(at.getTime() + 5 * 60_000)), '23P01');
  });

  it('respects branch working hours when they are set', async () => {
    await asUser(w.db, w.admin, (tx) => tx.query(`select public.set_branch_hours($1, $2::jsonb)`, [w.dhanori, JSON.stringify(
      [1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, opens_at: '10:00', closes_at: '14:00' })),
    )]));
    const p = await registerPatient(w.db, w.dhanoriReception.userId, w.dhanori, 'Hours');
    // 21/11/2026 is a Saturday: 07:00 IST is before opening, 11:00 IST is open.
    await expectError(() => book(w.db, w.dhanoriReception.userId, w.dhanori, p, new Date('2026-11-21T01:30:00Z')), '23514');
    await book(w.db, w.dhanoriReception.userId, w.dhanori, p, new Date('2026-11-21T05:30:00Z'));
    // Sunday has no hours.
    await expectError(() => book(w.db, w.dhanoriReception.userId, w.dhanori, p, new Date('2026-11-22T05:30:00Z')), '23514');
  });

  it('enforces the cancel and check-in permissions separately', async () => {
    const p = await registerPatient(w.db, w.receptionist.userId, w.main, 'Status');
    const a = await book(w.db, w.receptionist.userId, w.main, p);
    await expectError(() => asUser(w.db, w.receptionist.userId, (tx) => tx.query(`select public.set_appointment_status($1, 'cancelled')`, [a])), '23514'); // reason required
    await asUser(w.db, w.receptionist.userId, (tx) => tx.query(`select public.set_appointment_status($1, 'checked_in')`, [a]));
    await asUser(w.db, w.receptionist.userId, (tx) => tx.query(`select public.set_appointment_status($1, 'cancelled', 'Patient left')`, [a]));
  });

  it('turns a finalized follow-up date into a bookable follow-up', async () => {
    const p = await registerPatient(w.db, w.receptionist.userId, w.main, 'Follow');
    const c = await consult(w.db, w.doctor, w.main, p);
    await asUser(w.db, w.doctor, (tx) => tx.query(`update public.consultations set follow_up_date = current_date + 7 where id = $1`, [c]));
    await asUser(w.db, w.doctor, (tx) => tx.query(`select public.finalize_consultation($1)`, [c]));
    const f = await asUser(w.db, w.receptionist.userId, async (tx) => (await tx.query<{ id: string; branch_id: string }>(`select id, branch_id from public.follow_ups where consultation_id = $1`, [c])).rows[0]!);
    expect(f.branch_id).toBe(w.main);
    // Receptionists see follow-ups but booking them needs follow_ups.manage.
    await expectError(() => asUser(w.db, w.receptionist.userId, (tx) => tx.query(`select public.book_follow_up($1, '2026-12-01T05:00:00Z', '2026-12-01T05:15:00Z')`, [f.id])), '42501');
  });
});

describe('billing', () => {
  it('is idempotent and keeps cached totals consistent', async () => {
    const p = await registerPatient(w.db, w.receptionist.userId, w.main, 'Billing');
    const key = '11111111-1111-4111-8111-111111111111';
    const create = () => asUser(w.db, w.accountant.userId, async (tx) =>
      (await tx.query<{ id: string; total_paise: number }>(`select * from public.create_invoice($1, '[{"description":"Consultation","quantity":1,"unit_price_paise":60000,"tax_rate":0}]'::jsonb, 10000, null, null, $2, $3)`, [p, w.main, key])).rows[0]!,
    );
    const a = await create();
    const b = await create();
    expect(b.id).toBe(a.id);
    expect(a.total_paise).toBe(50000);

    const pay = () => asUser(w.db, w.accountant.userId, async (tx) =>
      (await tx.query<{ id: string }>(`select * from public.record_payment($1, 30000, 'upi', 'UPI-REF', now(), null, '22222222-2222-4222-8222-222222222222')`, [a.id])).rows[0]!.id,
    );
    expect(await pay()).toBe(await pay());
    await asUser(w.db, w.accountant.userId, (tx) => tx.query(`select public.record_refund($1, 5000, 'upi', 'Overcharged')`, [a.id]));
    const inv = await asUser(w.db, w.accountant.userId, async (tx) => (await tx.query<{ status: string; amount_paid_paise: number; amount_refunded_paise: number }>(`select status, amount_paid_paise, amount_refunded_paise from public.invoices where id = $1`, [a.id])).rows[0]!);
    expect(inv).toEqual({ status: 'partially_paid', amount_paid_paise: 30000, amount_refunded_paise: 5000 });
    await expectError(() => asUser(w.db, w.accountant.userId, (tx) => tx.query(`select public.void_invoice($1, 'Mistake')`, [a.id])), '23514');
  });

  it('lets the doctor view but not take payments', async () => {
    expect(await count(w.db, w.doctor, 'select 1 from public.invoices')).toBeGreaterThan(0);
    const inv = await asUser(w.db, w.doctor, async (tx) => (await tx.query<{ id: string }>(`select id from public.invoices limit 1`)).rows[0]!.id);
    await expectError(() => asUser(w.db, w.doctor, (tx) => tx.query(`select public.record_payment($1, 100, 'cash')`, [inv])), '42501');
  });
});

describe('dashboards and reports', () => {
  it('give the admin all branches with a branch filter', async () => {
    const all = await asUser(w.db, w.admin, async (tx) => (await tx.query<{ org_overview: Record<string, number> }>(`select public.org_overview()`)).rows[0]!.org_overview);
    const main = await asUser(w.db, w.admin, async (tx) => (await tx.query<{ org_overview: Record<string, number> }>(`select public.org_overview($1)`, [w.main])).rows[0]!.org_overview);
    expect(all.branches_active).toBe(2);
    expect(main.branches_active).toBe(1);
    expect(all.patients_total).toBeGreaterThanOrEqual(main.patients_total!);
    expect(all).toHaveProperty('collected_paise');
    const branches = await asUser(w.db, w.admin, async (tx) => (await tx.query(`select * from public.branch_metrics(date '2026-01-01', date '2026-12-31')`)).rows);
    expect(branches).toHaveLength(2);
  });

  it('hide financial sections from staff without financial reports', async () => {
    const o = await asUser(w.db, w.receptionist.userId, async (tx) => (await tx.query<{ org_overview: Record<string, unknown> }>(`select public.org_overview()`)).rows[0]!.org_overview);
    expect(o).toHaveProperty('appointments_today');
    expect(o).not.toHaveProperty('collected_paise');
    await expectError(() => asUser(w.db, w.receptionist.userId, (tx) => tx.query(`select * from public.revenue_report(null, date '2026-11-01', date '2026-11-30')`)), '42501');
  });

  it('give the doctor a clinical overview across branches', async () => {
    const o = await asUser(w.db, w.doctor, async (tx) => (await tx.query<{ doctor_overview: Record<string, unknown> }>(`select public.doctor_overview()`)).rows[0]!.doctor_overview);
    expect(o).toHaveProperty('next_patient');
    expect((o.branch_schedule as unknown[]).length).toBe(2);
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`select public.doctor_overview()`)), '42501');
    const clinical = await asUser(w.db, w.doctor, async (tx) => (await tx.query<{ clinical_report: Record<string, number> }>(`select public.clinical_report(null, date '2026-01-01', date '2026-12-31')`)).rows[0]!.clinical_report);
    expect(clinical.consultations_finalized).toBeGreaterThanOrEqual(1);
  });

  it('report staff activity to the admin', async () => {
    const rows = await asUser(w.db, w.admin, async (tx) => (await tx.query<{ full_name: string; event_count: number }>(`select * from public.staff_activity(date '2026-01-01', date '2026-12-31')`)).rows);
    expect(rows.find((r) => r.full_name === 'Priya Sharma')!.event_count).toBeGreaterThan(0);
  });
});

describe('notifications', () => {
  it('tell the doctor about bookings made by staff', async () => {
    expect(await count(w.db, w.doctor, `select 1 from public.notifications where kind = 'appointment_booked'`)).toBeGreaterThan(0);
    expect(await count(w.db, w.receptionist.userId, 'select 1 from public.notifications')).toBe(0);
  });
});
