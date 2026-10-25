import { getSupabase, STORAGE_BUCKET } from '@/lib/supabase/client';
import type { UUID } from '@/types/domain';

function safeName(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
  // Original file names can contain patient names — store a random name instead.
  return `${crypto.randomUUID()}.${ext}`;
}

export async function uploadPatientFile(clinicId: UUID, patientId: UUID, file: File): Promise<string> {
  const path = `${clinicId}/patients/${patientId}/${safeName(file.name)}`;
  const { error } = await getSupabase().storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

/** Short-lived signed URL; the bucket is private. */
export async function getSignedUrl(path: string, expiresIn = 120): Promise<string> {
  const { data, error } = await getSupabase().storage.from(STORAGE_BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
