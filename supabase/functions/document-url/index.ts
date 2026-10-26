// Issue a short-lived signed URL for a patient document.
// 1. Look the document up with the CALLER's JWT, so RLS decides access
//    (clinical permission, patient assignment, tenant, soft-delete).
// 2. Only then use the service role to sign the URL and record an audit event.
// Clients have no direct storage SELECT on patient files, so this is the only
// download path and every access is logged.
import { createClient } from 'npm:@supabase/supabase-js@2.47.10';
import { z } from 'npm:zod@3.24.1';
import { corsHeaders } from '../_shared/cors.ts';
import { env, json } from '../_shared/http.ts';

const BodySchema = z.object({ documentId: z.string().uuid() });
const SIGNED_URL_SECONDS = 60;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401, origin);
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Invalid request' }, 400, origin);

  const url = env('SUPABASE_URL');
  const asCaller = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: authHeader } } });
  const { data: caller } = await asCaller.auth.getUser();
  if (!caller.user) return json({ error: 'Unauthorized' }, 401, origin);

  const { data: doc } = await asCaller
    .from('patient_documents')
    .select('id, storage_path, uploaded_at')
    .eq('id', parsed.data.documentId)
    .maybeSingle();
  // Same response whether the document is missing or forbidden (no enumeration).
  if (!doc || !doc.uploaded_at || !doc.storage_path) return json({ error: 'The record could not be found' }, 404, origin);

  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { error: logError } = await admin.rpc('log_document_access', { p_document: doc.id, p_actor: caller.user.id });
  if (logError) {
    // Fail closed: no audit record, no file.
    console.error('document-url: audit failed', logError.code);
    return json({ error: 'Something went wrong' }, 500, origin);
  }
  const { data: signed, error } = await admin.storage.from('clinic-files').createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS);
  if (error || !signed) return json({ error: 'Something went wrong' }, 500, origin);

  return json({ url: signed.signedUrl, expiresIn: SIGNED_URL_SECONDS }, 200, origin);
});
