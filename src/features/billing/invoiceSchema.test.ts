import { describe, expect, it } from 'vitest';
import { invoiceSchema, paymentSchema } from './invoiceSchema';

const patient = '7d1c2b8e-2f62-4d1a-9b4b-0d6b9a7f1e21';

describe('invoice schema', () => {
  it('converts rupee inputs to paise', () => {
    const v = invoiceSchema.parse({
      patient_id: patient,
      items: [{ description: 'Consultation', item_type: 'consultation', quantity: '1', unit_price: '500.50', tax_rate: '0' }],
      discount: '50',
      notes: '',
    });
    expect(v.items[0]!.unit_price).toBe(50050);
    expect(v.discount).toBe(5000);
  });

  it('requires a patient and at least one line', () => {
    expect(invoiceSchema.safeParse({ patient_id: '', items: [], discount: '', notes: '' }).success).toBe(false);
  });

  it('rejects GST above 28%', () => {
    const r = invoiceSchema.safeParse({ patient_id: patient, items: [{ description: 'X', item_type: 'other', quantity: 1, unit_price: 1, tax_rate: 40 }], discount: 0 });
    expect(r.success).toBe(false);
  });
});

describe('payment schema', () => {
  it('rejects zero and negative amounts', () => {
    expect(paymentSchema.safeParse({ amount: '0', method: 'cash', paid_on: '2026-10-25' }).success).toBe(false);
    expect(paymentSchema.safeParse({ amount: '-5', method: 'cash', paid_on: '2026-10-25' }).success).toBe(false);
    expect(paymentSchema.parse({ amount: '1,200', method: 'upi', paid_on: '2026-10-25' }).amount).toBe(120000);
  });
});
