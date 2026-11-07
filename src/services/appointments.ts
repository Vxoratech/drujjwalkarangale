import { getSupabase } from '@/lib/supabase/client';
import type { Appointment, AppointmentSource, AppointmentStatus, AppointmentType, AppointmentWithPatient, Timestamp, UUID } from '@/types/domain';
import { unwrap } from './_helpers';

const COLUMNS = 'id, branch_id, patient_id, starts_at, ends_at, type, status, reason, source, notes, cancellation_reason, cancelled_at, patient:patients(id, first_name, last_name, patient_code, phone)';

export interface AppointmentListParams {
  from: Timestamp;
  to: Timestamp;
  branchId?: UUID | null;
  patientId?: UUID;
  statuses?: AppointmentStatus[];
}

/** Appointments in a time range. RLS limits staff to their branches; `branchId` narrows further. */
export async function listAppointments(params: AppointmentListParams): Promise<AppointmentWithPatient[]> {
  let q = getSupabase().from('appointments').select(COLUMNS).gte('starts_at', params.from).lt('starts_at', params.to);
  if (params.branchId) q = q.eq('branch_id', params.branchId);
  if (params.patientId) q = q.eq('patient_id', params.patientId);
  if (params.statuses?.length) q = q.in('status', params.statuses);
  return unwrap<AppointmentWithPatient[]>(await q.order('starts_at'));
}

export async function listPatientAppointments(patientId: UUID): Promise<AppointmentWithPatient[]> {
  return unwrap<AppointmentWithPatient[]>(await getSupabase().from('appointments').select(COLUMNS).eq('patient_id', patientId).order('starts_at', { ascending: false }).limit(50));
}

export async function getAppointment(id: UUID): Promise<AppointmentWithPatient> {
  return unwrap<AppointmentWithPatient>(await getSupabase().from('appointments').select(COLUMNS).eq('id', id).single());
}

export interface AppointmentInput {
  patient_id: UUID;
  branch_id: UUID;
  starts_at: Timestamp;
  ends_at: Timestamp;
  type: AppointmentType;
  source: AppointmentSource;
  reason: string | null;
  notes: string | null;
}

export async function createAppointment(input: AppointmentInput): Promise<Appointment> {
  return unwrap<Appointment>(await getSupabase().from('appointments').insert(input).select('*').single());
}

export async function rescheduleAppointment(id: UUID, input: Omit<AppointmentInput, 'patient_id' | 'source'>): Promise<Appointment> {
  return unwrap<Appointment>(await getSupabase().from('appointments').update(input).eq('id', id).select('*').single());
}

export async function setAppointmentStatus(id: UUID, status: AppointmentStatus, reason?: string): Promise<Appointment> {
  return unwrap<Appointment>(await getSupabase().rpc('set_appointment_status', { p_appointment: id, p_status: status, p_reason: reason ?? null }));
}

/** Allowed next statuses — mirrors private.validate_appointment_status in SQL. */
export const NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show'],
  checked_in: ['in_consultation', 'completed', 'cancelled', 'no_show'],
  in_consultation: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};
