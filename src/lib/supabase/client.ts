import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readEnv } from '@/lib/env';

let client: SupabaseClient | null = null;

/** Lazily-created browser client. Uses only the public anon key; RLS enforces access. */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const result = readEnv();
  if (!result.ok) {
    throw new Error('Supabase is not configured');
  }
  client = createClient(result.env.VITE_SUPABASE_URL, result.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export const STORAGE_BUCKET = 'clinic-files';
