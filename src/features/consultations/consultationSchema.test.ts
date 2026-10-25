import { describe, expect, it } from 'vitest';
import { computeBmi, consultationSchema, toConsultationForm, toConsultationPayload } from './consultationSchema';

describe('consultation schema', () => {
  const base = { ...toConsultationForm(), chief_complaint: 'Joint pain' };

  it('accepts a minimal consultation and converts blanks to null', () => {
    const v = consultationSchema.parse(base);
    const { input, exam } = toConsultationPayload(v, { patient_id: 'p', doctor_id: 'd', appointment_id: null });
    expect(input.pulse_bpm).toBeNull();
    expect(input.diagnosis).toBeNull();
    expect(exam.agni).toBeNull();
    expect(exam.vikriti).toEqual([]);
  });

  it('validates vital ranges', () => {
    const r = consultationSchema.safeParse({ ...base, pulse_bpm: '400' });
    expect(r.success).toBe(false);
  });

  it('requires both BP values and systolic > diastolic', () => {
    expect(consultationSchema.safeParse({ ...base, bp_systolic: '120' }).success).toBe(false);
    expect(consultationSchema.safeParse({ ...base, bp_systolic: '80', bp_diastolic: '120' }).success).toBe(false);
    expect(consultationSchema.safeParse({ ...base, bp_systolic: '120', bp_diastolic: '80' }).success).toBe(true);
  });

  it('computes BMI', () => {
    expect(computeBmi(68, 158)).toBe(27.2);
    expect(computeBmi(null, 158)).toBeNull();
  });
});
