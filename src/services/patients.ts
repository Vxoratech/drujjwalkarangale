import { getSupabase } from '@/lib/supabase/client';
import type { Page, Patient, PatientStatus, UUID } from '@/types/domain';
import { escapeFilter, unwrap, unwrapPage } from './_helpers';

export interface PatientListParams {
  search?: string;
  page: number;
  pageSize: number;
  sort?: { key: 'name' | 'patient_code' | 'created_at'; direction: 'asc' | 'desc' };
  /** Defaults to active patients only. */
  status?: PatientStatus | 'all';
}

export type PatientListItem = Pick<
  Patient,
  'id' | 'patient_code' | 'first_name' | 'last_name' | 'gender' | 'date_of_birth' | 'approx_age_years' | 'phone' | 'city' | 'prakriti' | 'assigned_doctor_id' | 'status' | 'created_at'
>;

const LIST_COLUMNS = 'id, patient_code, first_name, last_name, gender, date_of_birth, approx_age_years, phone, city, prakriti, assigned_doctor_id, status, created_at';

export async function listPatients(clinicId: UUID, params: PatientListParams): Promise<Page<PatientListItem>> {
  let q = getSupabase().from('patients').select(LIST_COLUMNS, { count: 'exact' }).eq('clinic_id', clinicId);
  const status = params.status ?? 'active';
  if (status !== 'all') q = q.eq('status', status);
  const term = params.search ? escapeFilter(params.search) : '';
  if (term) {
    const digits = term.replace(/\D/g, '');
    const parts = [`first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`, `patient_code.ilike.%${term}%`];
    if (digits.length >= 3) parts.push(`phone.ilike.%${digits.slice(-10)}%`);
    q = q.or(parts.join(','));
  }
  const sort = params.sort ?? { key: 'created_at', direction: 'desc' };
  const asc = sort.direction === 'asc';
  if (sort.key === 'name') q = q.order('first_name', { ascending: asc }).order('last_name', { ascending: asc });
  else q = q.order(sort.key, { ascending: asc });
  const from = (params.page - 1) * params.pageSize;
  return unwrapPage<PatientListItem>(await q.range(from, from + params.pageSize - 1));
}

/** Lightweight lookup for pickers (appointment booking, invoices). */
export async function searchPatients(clinicId: UUID, search: string, limit = 8): Promise<PatientListItem[]> {
  const page = await listPatients(clinicId, { search, page: 1, pageSize: limit, sort: { key: 'name', direction: 'asc' } });
  return page.rows;
}

/** Opens a patient record and records a `patients.viewed` audit event (server-side). */
export async function viewPatient(id: UUID): Promise<Patient> {
  return unwrap<Patient>(await getSupabase().rpc('view_patient', { p_patient: id }));
}

/** Plain read without an access log — for pickers and print headers. */
export async function getPatient(clinicId: UUID, id: UUID): Promise<Patient> {
  return unwrap<Patient>(await getSupabase().from('patients').select('*').eq('clinic_id', clinicId).eq('id', id).single());
}

export type PatientInput = Omit<Patient, 'id' | 'clinic_id' | 'patient_code' | 'created_at' | 'branch_id' | 'registered_on'>;

export async function createPatient(clinicId: UUID, input: PatientInput): Promise<Patient> {
  return unwrap<Patient>(await getSupabase().from('patients').insert({ ...input, clinic_id: clinicId }).select('*').single());
}

export async function updatePatient(clinicId: UUID, id: UUID, input: Partial<PatientInput>): Promise<Patient> {
  return unwrap<Patient>(await getSupabase().from('patients').update(input).eq('clinic_id', clinicId).eq('id', id).select('*').single());
}
