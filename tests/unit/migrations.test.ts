import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Safe-migration rules (Phase 12):
 * - forward-only files named <14-digit timestamp>_<snake_case>.sql, strictly increasing;
 * - destructive statements need an explicit, reviewed allowlist entry.
 */
const dir = join(import.meta.dirname, '../../supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

/** Reviewed destructive changes (none since the single-organization baseline of 03/11/2026). */
const ALLOWED_DESTRUCTIVE: string[] = [];

describe('migrations', () => {
  it('are named consistently and ordered by timestamp', () => {
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    const stamps = files.map((f) => f.slice(0, 14));
    expect(new Set(stamps).size).toBe(stamps.length);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it('contain no unreviewed destructive statements', () => {
    const found: string[] = [];
    for (const f of files) {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n');
      for (const raw of lines) {
        const line = raw.replace(/--.*$/, '').trim().toLowerCase();
        if (/^(drop table|truncate)\b|\bdrop column\b|^drop schema\b|^delete from [^\s]+;?$/.test(line)) found.push(`${f}: ${raw.trim()}`);
      }
    }
    expect(found.filter((x) => !ALLOWED_DESTRUCTIVE.includes(x))).toEqual([]);
  });

  it('never disable row level security or grant table access to anon', () => {
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8').toLowerCase();
      expect(sql, f).not.toMatch(/disable row level security|grant [a-z, ]+ on [^;]+ to anon\b/);
    }
  });
});
