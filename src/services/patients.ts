import { getSupabase } from '@/lib/supabase/client';
import type { DuplicateCandidate, MedicalProfile, Page, Patient, PatientStatus, UUID } from '@/types/domain';
import { escapeFilter, unwrap, unwrapPage } from './_helpers';

export interface PatientListParams {
  search?: string;
  page: number;
  pageSize: number;
  sort?: { key: 'name' | 'patient_code' | 'created_at'; direction: 'asc' | 'desc' };
  /** Defaults to active patients only. */
  status?: PatientStatus | 'all';
  /** Registering branch; patients are central, so this is a filter only. */
  branchId?: UUID;
}

export type PatientListItem = Pick<
  Patient,
  'id' | 'patient_code' | 'first_name' | 'last_name' | 'gender' | 'date_of_birth' | 'approx_age_years' | 'phone' | 'city' | 'registered_branch_id' | 'status' | 'created_at'
>;

const LIST_COLUMNS = 'id, patient_code, first_name, last_name, gender, date_of_birth, approx_age_years, phone, city, registered_branch_id, status, created_at';

export async function listPatients(params: PatientListParams): Promise<Page<PatientListItem>> {
  let q = getSupabase().from('patients').select(LIST_COLUMNS, { count: 'exact' });
  const status = params.status ?? 'active';
  if (status !== 'all') q = q.eq('status', status);
  if (params.branchId) q = q.eq('registered_branch_id', params.branchId);
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
export async function searchPatients(search: string, limit = 8): Promise<PatientListItem[]> {
  const page = await listPatients({ search, page: 1, pageSize: limit, sort: { key: 'name', direction: 'asc' } });
  return page.rows;
}

/** Opens a patient record and records a `patients.viewed` audit event (server-side). */
export async function viewPatient(id: UUID): Promise<Patient> {
  const row = unwrap<Patient | null>(await getSupabase().rpc('view_patient', { p_patient: id }));
  // The server returns no row (and audits the refusal) when the bulk-access brake trips.
  if (!row || !row.id) throw { code: '54000', message: 'Too many records opened in a short time. Please wait a few minutes.' };
  return row;
}

/** Plain read without an access log — for pickers and print headers. */
export async function getPatient(id: UUID): Promise<Patient> {
  return unwrap<Patient>(await getSupabase().from('patients').select('*').eq('id', id).single());
}

export type PatientInput = Omit<Patient, 'id' | 'patient_code' | 'created_at' | 'registered_branch_id' | 'registered_on' | 'duplicate_reviewed'>;

/** Likely existing records for a registration (same phone, similar name with matching age). */
export async function findPossibleDuplicates(input: { first_name: string; last_name: string; phone: string | null; date_of_birth: string | null; approx_age_years: number | null }): Promise<DuplicateCandidate[]> {
  return unwrap<DuplicateCandidate[]>(
    await getSupabase().rpc('find_possible_duplicates', {
      p_first_name: input.first_name,
      p_last_name: input.last_name,
      p_phone: input.phone,
      p_date_of_birth: input.date_of_birth,
      p_approx_age: input.approx_age_years,
    }),
  );
}

/** Thrown by the server when duplicates exist and the user has not reviewed them. */
export const DUPLICATE_REVIEW_REQUIRED = 'P0003';

export async function registerPatient(input: PatientInput, branchId: UUID | null, duplicateReviewed: boolean): Promise<Patient> {
  return unwrap<Patient>(await getSupabase().rpc('register_patient', { p_patient: input, p_branch: branchId, p_duplicate_reviewed: duplicateReviewed }));
}

export async function updatePatient(id: UUID, input: Partial<PatientInput>): Promise<Patient> {
  return unwrap<Patient>(await getSupabase().from('patients').update(input).eq('id', id).select('*').single());
}

/** Medical background; null when none is recorded or the viewer lacks the history permission. */
export async function getMedicalProfile(patientId: UUID): Promise<MedicalProfile | null> {
  return unwrap<MedicalProfile | null>(await getSupabase().from('patient_medical_profiles').select('patient_id, blood_group, allergies, chronic_conditions, prakriti').eq('patient_id', patientId).maybeSingle());
}

export async function saveMedicalProfile(patientId: UUID, input: Omit<MedicalProfile, 'patient_id'>): Promise<MedicalProfile> {
  return unwrap<MedicalProfile>(await getSupabase().rpc('save_medical_profile', { p_patient: patientId, p_medical: input }));
}
