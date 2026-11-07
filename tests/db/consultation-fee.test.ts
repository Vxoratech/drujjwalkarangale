import { beforeAll, describe, expect, it } from 'vitest';
import { asUser } from './harness';
import { book, createWorld, expectError, registerPatient, type World } from './world';

let w: World;
let patient: string;

const ITEMS = JSON.stringify([{ medicine_name: 'Triphala churna', dose: '5 g', frequency: 'At bedtime' }]);

type Linked = { invoice_id: string | null; consultation_fee_paise: string | null };
type Rx = Linked & { prescription_no: string };
type Invoice = { status: string; total_paise: string; amount_paid_paise: string; notes: string; appointment_id: string | null; branch_id: string };

const invoice = (id: string) => asUser(w.db, w.doctor, async (tx) => (await tx.query<Invoice>(`select * from public.invoices where id = $1`, [id])).rows[0]!);
const invoicesFor = (p: string) => asUser(w.db, w.doctor, async (tx) => (await tx.query<Invoice>(`select * from public.invoices where patient_id = $1 and status <> 'void'`, [p])).rows);

async function saveConsultation(fee: number | null, appointment: string | null = null): Promise<string> {
  return asUser(w.db, w.doctor, async (tx) =>
    (await tx.query<{ save_consultation: string }>(`select public.save_consultation(null, $1::jsonb, '{}'::jsonb)`, [
      JSON.stringify({ patient_id: patient, branch_id: w.main, appointment_id: appointment, chief_complaint: 'Acidity', consultation_fee_paise: fee }),
    ])).rows[0]!.save_consultation,
  );
}
const finalize = (id: string) => asUser(w.db, w.doctor, async (tx) => (await tx.query<Linked>(`select * from public.finalize_consultation($1)`, [id])).rows[0]!);

async function rxDraft(fee: number | null, consultation: string | null, id: string | null = null): Promise<string> {
  return asUser(w.db, w.doctor, async (tx) =>
    (await tx.query<{ save_prescription_draft: string }>(`select public.save_prescription_draft($1, $2, $3, $4::jsonb, $5::jsonb)`, [
      id, patient, consultation, JSON.stringify({ branch_id: w.main, consultation_fee_paise: fee }), ITEMS,
    ])).rows[0]!.save_prescription_draft,
  );
}
const issue = (id: string) => asUser(w.db, w.doctor, async (tx) => (await tx.query<Rx>(`select * from public.issue_prescription($1, true)`, [id])).rows[0]!);
const revise = (id: string) => asUser(w.db, w.doctor, (tx) => tx.query(`select public.revise_prescription($1, 'Fee corrected')`, [id]));

beforeAll(async () => {
  w = await createWorld();
});

describe('consultation fee', () => {
  it('is billed once when the consultation is finalized, however many prescriptions the visit has', async () => {
    patient = await registerPatient(w.db, w.receptionist.userId, w.main, 'Kavita');
    const appt = await book(w.db, w.receptionist.userId, w.main, patient);
    const id = await saveConsultation(50000, appt);
    // Two prescriptions for the visit; a fee sent with them is ignored.
    await issue(await rxDraft(99900, id));
    await issue(await rxDraft(null, id));
    expect(await invoicesFor(patient)).toHaveLength(0);

    const row = await finalize(id);
    expect(Number(row.consultation_fee_paise)).toBe(50000);
    const inv = await invoice(row.invoice_id!);
    expect(Number(inv.total_paise)).toBe(50000);
    expect(inv).toMatchObject({ status: 'issued', branch_id: w.main, appointment_id: appt });
    expect(await invoicesFor(patient)).toHaveLength(1);
    // Finalizing again does not bill again.
    expect((await finalize(id)).invoice_id).toBe(row.invoice_id);
    expect(await invoicesFor(patient)).toHaveLength(1);
    // Billing staff see it without any clinical access.
    const seen = await asUser(w.db, w.accountant.userId, async (tx) => (await tx.query('select 1 from public.invoices where id = $1', [row.invoice_id])).rows.length);
    expect(seen).toBe(1);
  });

  it('raises no invoice for a free visit', async () => {
    patient = await registerPatient(w.db, w.receptionist.userId, w.main, 'Meena');
    expect((await finalize(await saveConsultation(null))).invoice_id).toBeNull();
    expect(await invoicesFor(patient)).toHaveLength(0);
  });

  it('cannot be linked to an invoice or given a negative fee by hand', async () => {
    patient = await registerPatient(w.db, w.receptionist.userId, w.main, 'Sushila');
    const id = await saveConsultation(10000);
    const other = await asUser(w.db, w.accountant.userId, async (tx) =>
      (await tx.query<{ id: string }>(`select id from public.create_invoice($1, '[{"description":"Visit","quantity":1,"unit_price_paise":100}]'::jsonb, 0, null, null, $2)`, [patient, w.main])).rows[0]!.id,
    );
    await expectError(() => asUser(w.db, w.doctor, (tx) => tx.query(`update public.consultations set invoice_id = $2 where id = $1`, [id, other])), '42501');
    await expectError(() => saveConsultation(-1), '23514');
  });
});

describe('fee on a prescription written without a consultation', () => {
  it('is billed when issued, replaced while unpaid if a revision changes it, and never changed once paid', async () => {
    patient = await registerPatient(w.db, w.receptionist.userId, w.main, 'Vandana');
    const id = await rxDraft(40000, null);
    const first = await issue(id);
    expect(Number((await invoice(first.invoice_id!)).total_paise)).toBe(40000);
    expect((await invoice(first.invoice_id!)).notes).toBe(`Prescription ${first.prescription_no}`);

    await revise(id);
    expect((await issue(await rxDraft(40000, null, id))).invoice_id).toBe(first.invoice_id);
    await revise(id);
    const second = await issue(await rxDraft(30000, null, id));
    expect(second.invoice_id).not.toBe(first.invoice_id);
    expect((await invoice(first.invoice_id!)).status).toBe('void');

    await asUser(w.db, w.accountant.userId, (tx) => tx.query(`select public.record_payment($1, 30000, 'cash')`, [second.invoice_id]));
    await revise(id);
    expect((await issue(await rxDraft(70000, null, id))).invoice_id).toBe(second.invoice_id);
    expect((await invoice(second.invoice_id!)).status).toBe('paid');
  });

  it('cannot be linked to an invoice by hand', async () => {
    const id = await rxDraft(10000, null);
    await expectError(() => asUser(w.db, w.doctor, (tx) => tx.query(`update public.prescriptions set invoice_id = gen_random_uuid() where id = $1`, [id])), '42501');
  });
});
