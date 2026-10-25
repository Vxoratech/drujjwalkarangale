import { z } from 'zod';
import { DOSE_TIMINGS, MEDICINE_FORMS, type Prescription } from '@/types/domain';
import type { PrescriptionItemInput } from '@/services/clinical';

export const prescriptionItemSchema = z.object({
  medicine_name: z.string().trim().min(1).max(160),
  form: z.enum(MEDICINE_FORMS),
  dose: z.string().trim().min(1).max(80),
  frequency: z.string().trim().min(1).max(80),
  timing: z.enum(DOSE_TIMINGS),
  anupana: z.string().trim().max(120).optional().or(z.literal('')),
  duration_days: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 365), { message: 'range:1:365' }),
  instructions: z.string().trim().max(500).optional().or(z.literal('')),
});

export const prescriptionSchema = z.object({
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  items: z.array(prescriptionItemSchema).max(50),
});

export type PrescriptionFormInput = z.input<typeof prescriptionSchema>;
export type PrescriptionFormValues = z.output<typeof prescriptionSchema>;

export const emptyItem = (): PrescriptionFormInput['items'][number] => ({
  medicine_name: '',
  form: 'vati',
  dose: '',
  frequency: '',
  timing: 'after_food',
  anupana: '',
  duration_days: '',
  instructions: '',
});

export function toPrescriptionForm(rx?: Prescription | null): PrescriptionFormInput {
  return {
    notes: rx?.notes ?? '',
    items: rx?.items.length
      ? rx.items.map((i) => ({
          medicine_name: i.medicine_name,
          form: i.form,
          dose: i.dose,
          frequency: i.frequency,
          timing: i.timing,
          anupana: i.anupana ?? '',
          duration_days: i.duration_days ?? '',
          instructions: i.instructions ?? '',
        }))
      : [emptyItem()],
  };
}

export function toItemInputs(values: PrescriptionFormValues): PrescriptionItemInput[] {
  return values.items.map((i) => ({
    medicine_name: i.medicine_name,
    form: i.form,
    dose: i.dose,
    frequency: i.frequency,
    timing: i.timing,
    anupana: i.anupana || null,
    duration_days: i.duration_days,
    instructions: i.instructions || null,
  }));
}
