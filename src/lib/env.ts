import { z } from 'zod';

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
  VITE_APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; missing: string[] };

export function readEnv(source: Record<string, unknown> = import.meta.env): EnvResult {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) {
    // Defence in depth: a service-role JWT must never reach the browser bundle.
    if (looksLikeServiceRoleKey(parsed.data.VITE_SUPABASE_ANON_KEY)) {
      return { ok: false, missing: ['VITE_SUPABASE_ANON_KEY (a service-role key was supplied — use the anon/publishable key)'] };
    }
    return { ok: true, env: parsed.data };
  }
  return { ok: false, missing: parsed.error.issues.map((i) => i.path.join('.')) };
}

export function looksLikeServiceRoleKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    return json.role === 'service_role';
  } catch {
    return false;
  }
}
