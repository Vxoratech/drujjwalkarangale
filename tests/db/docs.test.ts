import { describe, expect, it } from 'vitest';
import { TABLES } from '../../scripts/schema-annotations';
import { createDatabase } from './harness';

describe('schema documentation', () => {
  it('annotates every public table (purpose, tenant scope, retention)', async () => {
    const db = await createDatabase();
    const res = await db.query<{ relname: string }>(
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' order by 1`,
    );
    const tables = res.rows.map((r) => r.relname);
    expect(tables.filter((t) => !TABLES[t])).toEqual([]);
    expect(Object.keys(TABLES).filter((t) => !tables.includes(t))).toEqual([]);
  });
});
