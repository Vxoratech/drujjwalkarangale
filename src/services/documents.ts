import { readEnv } from '@/lib/env';
import { getSupabase, STORAGE_BUCKET } from '@/lib/supabase/client';
import type { DocumentCategory, PatientDocument, UUID } from '@/types/domain';
import { unwrap } from './_helpers';

export async function listDocuments(clinicId: UUID, params: { patientId: UUID; investigationId?: UUID }): Promise<PatientDocument[]> {
  let q = getSupabase().from('patient_documents').select('*').eq('clinic_id', clinicId).eq('patient_id', params.patientId).not('uploaded_at', 'is', null);
  if (params.investigationId) q = q.eq('investigation_id', params.investigationId);
  return unwrap<PatientDocument[]>(await q.order('created_at', { ascending: false }));
}

/** Accepted types and size; mirrored by the bucket settings and patient_documents checks. */
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Display name for an uploaded file: no directories, control characters or
 * leading dots, collapsed whitespace, at most 200 characters (extension kept).
 * The storage path never uses this name; it is built from the document id.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const safe = cleaned || 'document';
  if (safe.length <= 200) return safe;
  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 && safe.length - dot <= 10 ? safe.slice(dot) : '';
  return safe.slice(0, 200 - ext.length) + ext;
}

export function validateDocumentFile(file: File): 'type' | 'size' | null {
  if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) return 'size';
  return null;
}

/** PUT the file to its reserved path with XHR so the UI can show progress. */
async function putObject(path: string, file: File, onProgress?: (fraction: number) => void): Promise<void> {
  const env = readEnv();
  if (!env.ok) throw new Error('Supabase is not configured');
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw { status: 401, message: 'JWT expired' };
  const url = `${env.env.VITE_SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', env.env.VITE_SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject({ status: xhr.status, code: xhr.status === 403 ? '42501' : undefined, message: 'Upload failed' }));
    xhr.onerror = () => reject({ message: 'network error' });
    xhr.send(file);
  });
}

/**
 * Three-step upload, each step authorised by RLS:
 * 1. insert the metadata row (the server assigns the storage path),
 * 2. upload to exactly that path (progress reported via `onProgress`),
 * 3. confirm, which verifies the object exists.
 * If step 2 fails the unconfirmed row is invisible and is purged after 24 h.
 */
export async function uploadDocument(
  clinicId: UUID,
  input: { patientId: UUID; file: File; title: string; category: DocumentCategory; investigationId?: UUID | null; consultationId?: UUID | null },
  onProgress?: (fraction: number) => void,
): Promise<PatientDocument> {
  const problem = validateDocumentFile(input.file);
  if (problem) throw { code: '23514', message: problem === 'type' ? 'unsupported type' : 'too large' };
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
        title: input.title.trim().slice(0, 160) || sanitizeFileName(input.file.name).slice(0, 160),
        file_name: sanitizeFileName(input.file.name),
        mime_type: input.file.type,
        size_bytes: input.file.size,
      })
      .select('*')
      .single(),
  );
  await putObject(row.storage_path, input.file, onProgress);
  onProgress?.(1);
  return unwrap<PatientDocument>(await db.rpc('confirm_document_upload', { p_document: row.id }));
}

/** Short-lived signed URL from the document-url Edge Function (access is checked and audited server-side). */
export async function getDocumentUrl(documentId: UUID): Promise<string> {
  const { data, error } = await getSupabase().functions.invoke<{ url: string }>('document-url', { body: { documentId } });
  if (error) {
    const status = (error as { context?: Response }).context?.status;
    if (status === 429) throw { code: '54000', message: 'Too many requests. Please try again later.' };
    throw { code: status === 404 ? 'P0002' : status === 401 ? 'PGRST301' : undefined, message: 'Document link failed', status };
  }
  if (!data?.url) throw { message: 'The record could not be found', code: 'P0002' };
  return data.url;
}

export async function deleteDocument(documentId: UUID, reason: string): Promise<void> {
  unwrap(await getSupabase().rpc('delete_document', { p_document: documentId, p_reason: reason }));
}
