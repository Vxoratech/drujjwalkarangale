import { getSupabase } from '@/lib/supabase/client';
import type {
  AyurvedicExamination,
  Consultation,
  Investigation,
  InvestigationStatus,
  Prescription,
  PrescriptionItem,
  UUID,
} from '@/types/domain';
import { unwrap } from './_helpers';

// ---------------------------------------------------------------- consultations

export type ConsultationSummary = Pick<
  Consultation,
  'id' | 'patient_id' | 'doctor_id' | 'status' | 'visit_date' | 'chief_complaint' | 'diagnosis' | 'ayurvedic_diagnosis' | 'follow_up_date'
> & { patient?: { first_name: string; last_name: string; patient_code: string } | null };

const SUMMARY = 'id, patient_id, doctor_id, status, visit_date, chief_complaint, diagnosis, ayurvedic_diagnosis, follow_up_date';

export async function listConsultations(clinicId: UUID, params: { patientId?: UUID; doctorId?: UUID; status?: 'draft' | 'finalized'; limit?: number }): Promise<ConsultationSummary[]> {
  let q = getSupabase().from('consultations').select(`${SUMMARY}, patient:patients(first_name, last_name, patient_code)`).eq('clinic_id', clinicId);
  if (params.patientId) q = q.eq('patient_id', params.patientId);
  if (params.doctorId) q = q.eq('doctor_id', params.doctorId);
  if (params.status) q = q.eq('status', params.status);
  return unwrap<ConsultationSummary[]>(await q.order('visit_date', { ascending: false }).order('created_at', { ascending: false }).limit(params.limit ?? 50));
}

export interface ConsultationBundle {
  consultation: Consultation;
  examination: AyurvedicExamination | null;
}

export async function getConsultation(clinicId: UUID, id: UUID): Promise<ConsultationBundle> {
  const consultation = unwrap<Consultation>(await getSupabase().from('consultations').select('*').eq('clinic_id', clinicId).eq('id', id).single());
  const examination = unwrap<AyurvedicExamination | null>(await getSupabase().from('ayurvedic_examinations').select('*').eq('consultation_id', id).maybeSingle());
  return { consultation, examination };
}

export async function findConsultationForAppointment(clinicId: UUID, appointmentId: UUID): Promise<UUID | null> {
  const row = unwrap<{ id: UUID } | null>(await getSupabase().from('consultations').select('id').eq('clinic_id', clinicId).eq('appointment_id', appointmentId).maybeSingle());
  return row?.id ?? null;
}

export type ConsultationInput = Omit<Consultation, 'id' | 'clinic_id' | 'status' | 'finalized_at' | 'created_at' | 'visit_date'>;
export type ExaminationInput = Omit<AyurvedicExamination, 'id' | 'clinic_id' | 'consultation_id' | 'patient_id'>;

/** Save consultation + examination atomically (public.save_consultation, RLS-enforced). */
export async function saveConsultation(clinicId: UUID, input: ConsultationInput, exam: ExaminationInput, id?: UUID): Promise<UUID> {
  return unwrap<UUID>(
    await getSupabase().rpc('save_consultation', { p_clinic: clinicId, p_id: id ?? null, p_data: input, p_exam: exam }),
  );
}

export async function finalizeConsultation(id: UUID): Promise<Consultation> {
  return unwrap<Consultation>(await getSupabase().rpc('finalize_consultation', { p_consultation: id }));
}

// ---------------------------------------------------------------- prescriptions

const RX_COLUMNS = '*, items:prescription_items(*)';

function sortItems(rx: Prescription): Prescription {
  return { ...rx, items: [...(rx.items ?? [])].sort((a, b) => a.position - b.position) };
}

export async function listPrescriptions(clinicId: UUID, params: { patientId?: UUID; consultationId?: UUID }): Promise<Prescription[]> {
  let q = getSupabase().from('prescriptions').select(RX_COLUMNS).eq('clinic_id', clinicId);
  if (params.patientId) q = q.eq('patient_id', params.patientId);
  if (params.consultationId) q = q.eq('consultation_id', params.consultationId);
  return unwrap<Prescription[]>(await q.order('created_at', { ascending: false })).map(sortItems);
}

export async function getPrescription(clinicId: UUID, id: UUID): Promise<Prescription> {
  return sortItems(unwrap<Prescription>(await getSupabase().from('prescriptions').select(RX_COLUMNS).eq('clinic_id', clinicId).eq('id', id).single()));
}

export type PrescriptionItemInput = Omit<PrescriptionItem, 'id' | 'prescription_id' | 'position'>;

/** Save a draft prescription and replace its items in one transaction (public.save_prescription_draft). */
export async function savePrescriptionDraft(
  clinicId: UUID,
  input: { patient_id: UUID; consultation_id: UUID | null; notes: string | null },
  items: PrescriptionItemInput[],
  id?: UUID,
): Promise<UUID> {
  return unwrap<UUID>(
    await getSupabase().rpc('save_prescription_draft', {
      p_clinic: clinicId,
      p_id: id ?? null,
      p_patient: input.patient_id,
      p_consultation: input.consultation_id,
      p_notes: input.notes,
      p_items: items,
    }),
  );
}

export async function issuePrescription(id: UUID): Promise<Prescription> {
  return unwrap<Prescription>(await getSupabase().rpc('issue_prescription', { p_prescription: id }));
}

export async function cancelPrescription(clinicId: UUID, id: UUID): Promise<void> {
  unwrap(await getSupabase().from('prescriptions').update({ status: 'cancelled' }).eq('clinic_id', clinicId).eq('id', id).select('id').single());
}

// ---------------------------------------------------------------- investigations

export async function listInvestigations(clinicId: UUID, params: { patientId?: UUID; open?: boolean }): Promise<Investigation[]> {
  let q = getSupabase().from('investigations').select('*').eq('clinic_id', clinicId);
  if (params.patientId) q = q.eq('patient_id', params.patientId);
  if (params.open) q = q.in('status', ['ordered', 'sample_collected']);
  return unwrap<Investigation[]>(await q.order('ordered_at', { ascending: false }).limit(100));
}

export async function orderInvestigation(
  clinicId: UUID,
  input: Pick<Investigation, 'patient_id' | 'consultation_id' | 'test_name' | 'category' | 'instructions' | 'ordered_by'>,
): Promise<Investigation> {
  return unwrap<Investigation>(await getSupabase().from('investigations').insert({ ...input, clinic_id: clinicId }).select('*').single());
}

export async function updateInvestigation(
  clinicId: UUID,
  id: UUID,
  input: { status: InvestigationStatus; result_summary: string | null; result_file_path?: string | null },
): Promise<Investigation> {
  return unwrap<Investigation>(await getSupabase().from('investigations').update(input).eq('clinic_id', clinicId).eq('id', id).select('*').single());
}
