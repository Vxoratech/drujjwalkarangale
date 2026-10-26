import { z } from 'zod';
import { DOSE_TIMINGS, MEDICINE_FORMS, MEDICINE_ROUTES, type Prescription, type PrescriptionTemplate } from '@/types/domain';
import type { PrescriptionHeaderInput, PrescriptionItemInput } from '@/services/clinical';

const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

export const prescriptionItemSchema = z.object({
  medicine_name: z.string().trim().min(1).max(160),
  form: z.enum(MEDICINE_FORMS),
  route: z.enum(MEDICINE_ROUTES),
  dose: z.string().trim().min(1).max(80),
  quantity: opt(40),
  frequency: z.string().trim().min(1).max(80),
  timing: z.enum(DOSE_TIMINGS),
  anupana: opt(120),
  duration_days: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 365), { message: 'range:1:365' }),
  instructions_en: opt(500),
  instructions_mr: opt(500),
});

export const prescriptionSchema = z.object({
  language: z.enum(['en', 'mr']),
  patient_instructions: opt(2000),
  follow_up_date: z.string().optional().or(z.literal('')),
  notes: opt(2000),
  items: z.array(prescriptionItemSchema).max(50),
});

export type PrescriptionFormInput = z.input<typeof prescriptionSchema>;
export type PrescriptionFormValues = z.output<typeof prescriptionSchema>;
type ItemInput = PrescriptionFormInput['items'][number];

export const emptyItem = (): ItemInput => ({
  medicine_name: '',
  form: 'vati',
  route: 'oral',
  dose: '',
  quantity: '',
  frequency: '',
  timing: 'after_food',
  anupana: '',
  duration_days: '',
  instructions_en: '',
  instructions_mr: '',
});

function toItemForm(i: Partial<PrescriptionItemInput>): ItemInput {
  return {
    ...emptyItem(),
    medicine_name: i.medicine_name ?? '',
    form: i.form ?? 'other',
    route: i.route ?? 'oral',
    dose: i.dose ?? '',
    quantity: i.quantity ?? '',
    frequency: i.frequency ?? '',
    timing: i.timing ?? 'after_food',
    anupana: i.anupana ?? '',
    duration_days: i.duration_days ?? '',
    instructions_en: i.instructions_en ?? '',
    instructions_mr: i.instructions_mr ?? '',
  };
}

export function toPrescriptionForm(rx?: Prescription | null, defaultLanguage: 'en' | 'mr' = 'en'): PrescriptionFormInput {
  return {
    language: rx?.language ?? defaultLanguage,
    patient_instructions: rx?.patient_instructions ?? '',
    follow_up_date: rx?.follow_up_date ?? '',
    notes: rx?.notes ?? '',
    items: rx?.items.length ? rx.items.map(toItemForm) : [emptyItem()],
  };
}

/** Template items replace the current list; the clinician must still review them. */
export function templateToItems(template: PrescriptionTemplate): ItemInput[] {
  return template.items.map(toItemForm);
}

export function toItemInputs(values: PrescriptionFormValues): PrescriptionItemInput[] {
  return values.items.map((i) => ({
    medicine_name: i.medicine_name,
    form: i.form,
    route: i.route,
    dose: i.dose,
    quantity: i.quantity || null,
    frequency: i.frequency,
    timing: i.timing,
    anupana: i.anupana || null,
    duration_days: i.duration_days,
    instructions_en: i.instructions_en || null,
    instructions_mr: i.instructions_mr || null,
  }));
}

export function toHeaderInput(values: PrescriptionFormValues): PrescriptionHeaderInput {
  return {
    language: values.language,
    patient_instructions: values.patient_instructions || null,
    follow_up_date: values.follow_up_date || null,
    notes: values.notes || null,
  };
}
