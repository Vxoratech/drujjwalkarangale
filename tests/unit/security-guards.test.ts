import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Static guards for browser code (Phase 12): output escaping, secrets, storage. */
const root = join(import.meta.dirname, '../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

const files = walk(join(root, 'src')).map((p) => ({ path: relative(root, p), src: readFileSync(p, 'utf8') }));

function offenders(pattern: RegExp, allow: string[] = []): string[] {
  return files.filter((f) => pattern.test(f.src) && !allow.includes(f.path)).map((f) => f.path);
}

describe('browser code security guards', () => {
  it('never renders raw HTML or evaluates strings (React escaping stays in force)', () => {
    expect(offenders(/dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(/)).toEqual([]);
    expect(offenders(/\beval\(|new Function\(/)).toEqual([]);
  });

  it('never creates public URLs for stored files', () => {
    expect(offenders(/getPublicUrl\(/)).toEqual([]);
  });

  it('contains no server secrets or service-role usage', () => {
    // env.ts only *detects* a misplaced service-role key in order to refuse it.
    expect(offenders(/SERVICE_ROLE|service_role|sb_secret_/, ['src/lib/env.ts'])).toEqual([]);
  });

  it('reads only the documented public VITE_* variables', () => {
    const used = new Set(files.flatMap((f) => [...f.src.matchAll(/VITE_[A-Z_]+/g)].map((m) => m[0])));
    expect([...used].sort()).toEqual(['VITE_APP_ENV', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL']);
  });

  it('stores only UI preferences in browser storage, never records', () => {
    const keys = new Set(files.flatMap((f) => [...f.src.matchAll(/(?:local|session)Storage\.(?:setItem)\((\w+|'[^']+')/g)].map((m) => m[1]!)));
    const declared = files.flatMap((f) => [...f.src.matchAll(/const (\w+_KEY|EXPIRED_FLAG) = '([^']+)'/g)].map((m) => [m[1]!, m[2]!] as const));
    const values = [...keys].map((k) => (k.startsWith("'") ? k.slice(1, -1) : declared.find(([n]) => n === k)?.[1] ?? `(dynamic:${k})`));
    // i18n writes through a helper (`key`) that is only called with its two constants.
    const allowed = ['vaidyora.locale', 'vaidyora.bilingual', 'vaidyora.sidebarCollapsed', 'vaidyora.activeClinic', 'vaidyora.sessionExpired', '(dynamic:key)'];
    expect(values.filter((v) => !allowed.includes(v))).toEqual([]);
  });

  it('does not log objects that might contain records', () => {
    expect(offenders(/console\.(log|info|debug)\(/)).toEqual([]);
  });
});
