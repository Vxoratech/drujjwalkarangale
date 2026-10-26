import { getSupabase, STORAGE_BUCKET } from '@/lib/supabase/client';
import type { DocumentCategory, PatientDocument, UUID } from '@/types/domain';
import { unwrap } from './_helpers';

export async function listDocuments(clinicId: UUID, params: { patientId: UUID; investigationId?: UUID }): Promise<PatientDocument[]> {
  let q = getSupabase().from('patient_documents').select('*').eq('clinic_id', clinicId).eq('patient_id', params.patientId).not('uploaded_at', 'is', null);
  if (params.investigationId) q = q.eq('investigation_id', params.investigationId);
  return unwrap<PatientDocument[]>(await q.order('created_at', { ascending: false }));
}

/**
 * Three-step upload, each step authorised by RLS:
 * 1. insert the metadata row (the server assigns the storage path),
 * 2. upload to exactly that path,
 * 3. confirm, which verifies the object exists.
 */
export async function uploadDocument(
  clinicId: UUID,
  input: { patientId: UUID; file: File; title: string; category: DocumentCategory; investigationId?: UUID | null; consultationId?: UUID | null },
): Promise<PatientDocument> {
  const db = getSupabase();
  const row = unwrap<PatientDocument>(
    await db
      .from('patient_documents')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patientId,
        investigation_id: input.investigationId ?? null,
        consultation_id: input.consultationId ?? null,
        category: input.category,
        title: input.title,
        file_name: input.file.name.slice(0, 200),
        mime_type: input.file.type,
        size_bytes: input.file.size,
      })
      .select('*')
      .single(),
  );
  const { error } = await db.storage.from(STORAGE_BUCKET).upload(row.storage_path, input.file, { contentType: input.file.type, upsert: false });
  if (error) throw error;
  return unwrap<PatientDocument>(await db.rpc('confirm_document_upload', { p_document: row.id }));
}

/** Short-lived signed URL from the document-url Edge Function (access is checked and audited server-side). */
export async function getDocumentUrl(documentId: UUID): Promise<string> {
  const { data, error } = await getSupabase().functions.invoke<{ url: string }>('document-url', { body: { documentId } });
  if (error || !data?.url) throw error ?? { message: 'The record could not be found', code: 'P0002' };
  return data.url;
}

export async function deleteDocument(documentId: UUID, reason: string): Promise<void> {
  unwrap(await getSupabase().rpc('delete_document', { p_document: documentId, p_reason: reason }));
}
