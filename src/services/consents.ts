import { getSupabase } from '@/lib/supabase/client';
import type { ConsentMethod, ConsentType, PatientConsent, UUID } from '@/types/domain';
import { unwrap } from './_helpers';

/** Current consent policy version shown to patients. Bump when the wording changes. */
export const CONSENT_POLICY_VERSION = '2026-10';

export async function listConsents(patientId: UUID): Promise<PatientConsent[]> {
  return unwrap<PatientConsent[]>(
    await getSupabase().from('patient_consents').select('*').eq('patient_id', patientId).order('granted_at', { ascending: false }),
  );
}

export async function grantConsent(input: { patientId: UUID; type: ConsentType; method: ConsentMethod; notes: string | null; recordedBy: UUID }): Promise<void> {
  unwrap(
    await getSupabase()
      .from('patient_consents')
      .insert({
        patient_id: input.patientId,
        consent_type: input.type,
        method: input.method,
        notes: input.notes,
        policy_version: CONSENT_POLICY_VERSION,
        recorded_by: input.recordedBy,
      })
      .select('id')
      .single(),
  );
}

export async function withdrawConsent(id: UUID): Promise<void> {
  unwrap(await getSupabase().from('patient_consents').update({ status: 'withdrawn' }).eq('id', id).select('id').single());
}
