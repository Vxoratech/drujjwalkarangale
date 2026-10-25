import { z } from 'zod';
import { optionalEmail, optionalPhone, optionalText, requiredText } from '@/lib/validation/schemas';
import { todayISO } from '@/lib/formatters';
import { BLOOD_GROUPS, PRAKRITIS, type Patient } from '@/types/domain';
import type { PatientInput } from '@/services/patients';

export const patientSchema = z.object({
  first_name: requiredText(80),
  last_name: optionalText(80),
  date_of_birth: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || (v >= '1900-01-01' && v <= todayISO()), { message: 'pastDate' }),
  gender: z.enum(['female', 'male', 'other', 'undisclosed']),
  phone: optionalPhone,
  email: optionalEmail,
  address_line: optionalText(240),
  city: optionalText(80),
  blood_group: z.enum(BLOOD_GROUPS).optional().or(z.literal('')),
  allergies: optionalText(1000),
  chronic_conditions: optionalText(1000),
  emergency_contact_name: optionalText(120),
  emergency_contact_phone: optionalPhone,
  prakriti: z.enum(PRAKRITIS).optional().or(z.literal('')),
  assigned_doctor_id: z.string().uuid().optional().or(z.literal('')),
  preferred_locale: z.enum(['en', 'mr']),
});

export type PatientFormValues = z.infer<typeof patientSchema>;

export function toFormValues(p?: Patient | null): PatientFormValues {
  return {
    first_name: p?.first_name ?? '',
    last_name: p?.last_name ?? '',
    date_of_birth: p?.date_of_birth ?? '',
    gender: p?.gender ?? 'undisclosed',
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    address_line: p?.address_line ?? '',
    city: p?.city ?? '',
    blood_group: p?.blood_group ?? '',
    allergies: p?.allergies ?? '',
    chronic_conditions: p?.chronic_conditions ?? '',
    emergency_contact_name: p?.emergency_contact_name ?? '',
    emergency_contact_phone: p?.emergency_contact_phone ?? '',
    prakriti: p?.prakriti ?? '',
    assigned_doctor_id: p?.assigned_doctor_id ?? '',
    preferred_locale: p?.preferred_locale ?? 'en',
  };
}

const blank = <T,>(v: T | '' | undefined): T | null => (v === '' || v === undefined ? null : typeof v === 'string' ? ((v.trim() || null) as T | null) : v);

export function toPatientInput(v: PatientFormValues): PatientInput {
  return {
    first_name: v.first_name.trim(),
    last_name: (v.last_name ?? '').trim(),
    date_of_birth: blank(v.date_of_birth),
    gender: v.gender,
    phone: blank(v.phone),
    email: blank(v.email),
    address_line: blank(v.address_line),
    city: blank(v.city),
    blood_group: blank(v.blood_group),
    allergies: blank(v.allergies),
    chronic_conditions: blank(v.chronic_conditions),
    emergency_contact_name: blank(v.emergency_contact_name),
    emergency_contact_phone: blank(v.emergency_contact_phone),
    prakriti: blank(v.prakriti),
    assigned_doctor_id: blank(v.assigned_doctor_id),
    preferred_locale: v.preferred_locale,
  };
}
