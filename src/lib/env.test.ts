import { describe, expect, it } from 'vitest';
import { looksLikeServiceRoleKey, readEnv } from './env';

const jwt = (payload: object) => `xx.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.yy`;

describe('readEnv', () => {
  it('reports missing configuration instead of faking a backend', () => {
    const r = readEnv({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(expect.arrayContaining(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']));
  });

  it('accepts a publishable key', () => {
    const r = readEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon', iss: 'supabase' }) });
    expect(r.ok).toBe(true);
  });

  it('refuses a service-role key in the browser', () => {
    expect(looksLikeServiceRoleKey(jwt({ role: 'service_role' }))).toBe(true);
    expect(looksLikeServiceRoleKey('sb_secret_abcdefghijklmnopqrstuvwxyz')).toBe(true);
    const r = readEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }) });
    expect(r.ok).toBe(false);
  });
});
