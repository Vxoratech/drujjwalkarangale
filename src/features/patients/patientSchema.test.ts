import { describe, expect, it } from 'vitest';
import { patientSchema, toFormValues, toPatientInput } from './patientSchema';

describe('patient form schema', () => {
  it('requires a first name', () => {
    const r = patientSchema.safeParse({ ...toFormValues(), first_name: '  ' });
    expect(r.success).toBe(false);
  });

  it('rejects future dates of birth and invalid phones', () => {
    const r = patientSchema.safeParse({ ...toFormValues(), first_name: 'Asha', date_of_birth: '2999-01-01', phone: 'abc' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('date_of_birth');
      expect(paths).toContain('phone');
    }
  });

  it('keeps an approximate age only when the date of birth is unknown', () => {
    expect(toPatientInput(patientSchema.parse({ ...toFormValues(), first_name: 'Asha', approx_age_years: '45' })).approx_age_years).toBe(45);
    // A date of birth wins: the age is calculated from it, never stored alongside it.
    const withDob = toPatientInput(patientSchema.parse({ ...toFormValues(), first_name: 'Asha', approx_age_years: '45', date_of_birth: '1980-01-01' }));
    expect(withDob).toMatchObject({ date_of_birth: '1980-01-01', approx_age_years: null });
  });

  it('maps blank optional fields to null', () => {
    const parsed = patientSchema.parse({ ...toFormValues(), first_name: ' Asha ', phone: '+91 98220 10001' });
    const input = toPatientInput(parsed);
    expect(input.first_name).toBe('Asha');
    expect(input.email).toBeNull();
    expect(input.phone).toBe('+91 98220 10001');
  });
});
