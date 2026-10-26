import { describe, expect, it } from 'vitest';
import type { PrescriptionTemplate } from '@/types/domain';
import { emptyItem, prescriptionSchema, templateToItems, toHeaderInput, toItemInputs, toPrescriptionForm } from './prescriptionSchema';

describe('prescription schema', () => {
  it('requires medicine, dose and frequency for each line', () => {
    const r = prescriptionSchema.safeParse({ ...toPrescriptionForm(), items: [emptyItem()] });
    expect(r.success).toBe(false);
  });

  it('maps bilingual instructions and blank optional fields', () => {
    const v = prescriptionSchema.parse({
      ...toPrescriptionForm(null, 'mr'),
      items: [{ ...emptyItem(), medicine_name: 'Triphala Churna', dose: '3 g', frequency: 'At bedtime', instructions_mr: 'कोमट पाण्यासोबत', duration_days: '30' }],
    });
    const [item] = toItemInputs(v);
    expect(item).toMatchObject({ instructions_en: null, instructions_mr: 'कोमट पाण्यासोबत', duration_days: 30, quantity: null });
    expect(toHeaderInput(v)).toEqual({ language: 'mr', patient_instructions: null, follow_up_date: null, notes: null });
  });

  it('copies clinician-authored template items without inventing values', () => {
    const template = { items: [{ medicine_name: 'Yogaraj Guggulu', dose: '2 tablets', frequency: 'Twice daily' }] } as PrescriptionTemplate;
    const [item] = templateToItems(template);
    expect(item).toMatchObject({ medicine_name: 'Yogaraj Guggulu', dose: '2 tablets', frequency: 'Twice daily', anupana: '', duration_days: '' });
  });
});
