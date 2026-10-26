import { getSupabase } from '@/lib/supabase/client';
import type {
  ConsultationAmendment,
  AyurvedicExamination,
  Consultation,
  ExamFieldDefinition,
  FollowUp,
  Locale,
  PrescriptionRevision,
  PrescriptionTemplate,
  Timestamp,
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
> & {
  patient?: { first_name: string; last_name: string; patient_code: string } | null;
  exam?: Pick<AyurvedicExamination, 'prakriti' | 'vikriti' | 'agni' | 'ama' | 'nadi'>[] | Pick<AyurvedicExamination, 'prakriti' | 'vikriti' | 'agni' | 'ama' | 'nadi'> | null;
  amendments?: { id: UUID }[];
};

const SUMMARY = 'id, patient_id, doctor_id, status, visit_date, chief_complaint, diagnosis, ayurvedic_diagnosis, follow_up_date';

export async function listConsultations(clinicId: UUID, params: { patientId?: UUID; doctorId?: UUID; status?: 'draft' | 'finalized'; limit?: number }): Promise<ConsultationSummary[]> {
  let q = getSupabase()
    .from('consultations')
    .select(`${SUMMARY}, patient:patients(first_name, last_name, patient_code), exam:ayurvedic_examinations(prakriti, vikriti, agni, ama, nadi), amendments:consultation_amendments(id)`)
    .eq('clinic_id', clinicId);
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

export type ConsultationInput = Omit<Consultation, 'id' | 'clinic_id' | 'status' | 'finalized_at' | 'created_at' | 'visit_date' | 'branch_id'>;
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

export interface PrescriptionHeaderInput {
  notes: string | null;
  language: Locale;
  patient_instructions: string | null;
  follow_up_date: string | null;
}

/** Save a draft prescription and replace its items in one transaction (public.save_prescription_draft). */
export async function savePrescriptionDraft(
  clinicId: UUID,
  input: { patient_id: UUID; consultation_id: UUID | null; header: PrescriptionHeaderInput },
  items: PrescriptionItemInput[],
  id?: UUID,
): Promise<UUID> {
  return unwrap<UUID>(
    await getSupabase().rpc('save_prescription_draft', {
      p_clinic: clinicId,
      p_id: id ?? null,
      p_patient: input.patient_id,
      p_consultation: input.consultation_id,
      p_header: input.header,
      p_items: items,
    }),
  );
}

/** Issuing requires the clinician's explicit confirmation that every medicine and dose was reviewed. */
export async function issuePrescription(id: UUID, clinicianConfirmed: boolean): Promise<Prescription> {
  return unwrap<Prescription>(await getSupabase().rpc('issue_prescription', { p_prescription: id, p_clinician_confirmed: clinicianConfirmed }));
}

export type PrescriptionListItem = Omit<Prescription, 'items'> & {
  items: Pick<PrescriptionItem, 'medicine_name'>[];
  patient: { id: UUID; first_name: string; last_name: string; patient_code: string } | null;
};

export interface PrescriptionSearchParams {
  page: number;
  pageSize: number;
  status?: 'issued' | 'draft' | 'cancelled';
  doctorId?: UUID;
  from?: string;
  to?: string;
  /** Prescription number, patient name or patient ID. */
  search?: string;
}

/** Clinic-wide prescription search (RLS limits admins to issued/cancelled prescriptions). */
export async function searchPrescriptions(clinicId: UUID, params: PrescriptionSearchParams): Promise<{ rows: PrescriptionListItem[]; total: number }> {
  const db = getSupabase();
  let q = db
    .from('prescriptions')
    .select('id, clinic_id, patient_id, doctor_id, consultation_id, prescription_no, status, language, revision_number, issued_at, created_at, items:prescription_items(medicine_name), patient:patients!inner(id, first_name, last_name, patient_code)', { count: 'exact' })
    .eq('clinic_id', clinicId);
  if (params.status) q = q.eq('status', params.status);
  if (params.doctorId) q = q.eq('doctor_id', params.doctorId);
  if (params.from) q = q.gte('created_at', params.from);
  if (params.to) q = q.lt('created_at', params.to);
  const term = params.search?.trim().replace(/[%_,().*\\]/g, '');
  if (term) {
    if (/^RX-/i.test(term)) q = q.ilike('prescription_no', `%${term}%`);
    else q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,patient_code.ilike.%${term}%`, { referencedTable: 'patients' });
  }
  const from = (params.page - 1) * params.pageSize;
  const res = await q.order('created_at', { ascending: false }).range(from, from + params.pageSize - 1);
  if (res.error) throw res.error;
  return { rows: (res.data ?? []) as unknown as PrescriptionListItem[], total: res.count ?? 0 };
}

export async function listAmendments(consultationId: UUID): Promise<ConsultationAmendment[]> {
  return unwrap<ConsultationAmendment[]>(await getSupabase().from('consultation_amendments').select('*').eq('consultation_id', consultationId).order('created_at'));
}

export async function addAmendment(clinicId: UUID, input: { consultationId: UUID; reason: string; content: string }): Promise<void> {
  unwrap(
    await getSupabase()
      .from('consultation_amendments')
      .insert({ clinic_id: clinicId, consultation_id: input.consultationId, reason: input.reason, content: input.content })
      .select('id')
      .single(),
  );
}

/** Re-open an issued prescription as the next revision; the issued version stays in the revision history. */
export async function revisePrescription(id: UUID, reason: string): Promise<Prescription> {
  return unwrap<Prescription>(await getSupabase().rpc('revise_prescription', { p_prescription: id, p_reason: reason }));
}

export async function listPrescriptionRevisions(prescriptionId: UUID): Promise<PrescriptionRevision[]> {
  return unwrap<PrescriptionRevision[]>(
    await getSupabase().from('prescription_revisions').select('*').eq('prescription_id', prescriptionId).order('revision_number', { ascending: false }),
  );
}

export async function listTemplates(clinicId: UUID): Promise<PrescriptionTemplate[]> {
  return unwrap<PrescriptionTemplate[]>(await getSupabase().from('prescription_templates').select('*').eq('clinic_id', clinicId).eq('is_active', true).order('name'));
}

export async function saveTemplate(clinicId: UUID, input: { name: string; items: PrescriptionItemInput[]; patient_instructions: string | null; is_shared: boolean }): Promise<void> {
  unwrap(await getSupabase().from('prescription_templates').insert({ ...input, clinic_id: clinicId }).select('id').single());
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
  input: { status: InvestigationStatus; result_summary: string | null; notes?: string | null },
): Promise<Investigation> {
  return unwrap<Investigation>(await getSupabase().from('investigations').update(input).eq('clinic_id', clinicId).eq('id', id).select('*').single());
}

// ---------------------------------------------------------------- examination fields

export async function listExamFields(clinicId: UUID, opts: { includeInactive?: boolean } = {}): Promise<ExamFieldDefinition[]> {
  let q = getSupabase().from('exam_field_definitions').select('*').eq('clinic_id', clinicId);
  if (!opts.includeInactive) q = q.eq('is_active', true);
  return unwrap<ExamFieldDefinition[]>(await q.order('position').order('label_en'));
}

export type ExamFieldInput = Pick<ExamFieldDefinition, 'key' | 'label_en' | 'label_mr' | 'field_type' | 'options' | 'unit' | 'position' | 'is_active'>;

export async function saveExamField(clinicId: UUID, input: ExamFieldInput, id?: UUID): Promise<void> {
  const db = getSupabase().from('exam_field_definitions');
  // The key is the stable identifier for stored values, so it is fixed after creation.
  const editable: Omit<ExamFieldInput, 'key'> = {
    label_en: input.label_en,
    label_mr: input.label_mr,
    field_type: input.field_type,
    options: input.options,
    unit: input.unit,
    position: input.position,
    is_active: input.is_active,
  };
  const q = id ? db.update(editable).eq('id', id).eq('clinic_id', clinicId) : db.insert({ ...input, clinic_id: clinicId });
  unwrap(await q.select('id').single());
}

// ---------------------------------------------------------------- follow-ups

export async function listFollowUps(clinicId: UUID, params: { status?: 'pending'; dueBefore?: string; doctorId?: UUID; patientId?: UUID }): Promise<FollowUp[]> {
  let q = getSupabase().from('follow_ups').select('*, patient:patients(id, first_name, last_name, patient_code, phone)').eq('clinic_id', clinicId);
  if (params.status) q = q.eq('status', params.status);
  if (params.dueBefore) q = q.lte('due_date', params.dueBefore);
  if (params.doctorId) q = q.eq('doctor_id', params.doctorId);
  if (params.patientId) q = q.eq('patient_id', params.patientId);
  return unwrap<FollowUp[]>(await q.order('due_date').limit(100));
}

/** Book an appointment for a follow-up; both rows are written in one transaction. */
export async function bookFollowUp(input: { followUpId: UUID; startsAt: Timestamp; endsAt: Timestamp; reason: string | null }): Promise<UUID> {
  return unwrap<UUID>(
    await getSupabase().rpc('book_follow_up', { p_follow_up: input.followUpId, p_starts_at: input.startsAt, p_ends_at: input.endsAt, p_reason: input.reason }),
  );
}
