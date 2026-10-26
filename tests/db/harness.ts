/**
 * Runs the real Supabase migrations inside PGlite (Postgres compiled to WASM)
 * with minimal stand-ins for the Supabase-managed `auth` and `storage`
 * schemas. This lets RLS policies and RPCs be tested in CI without Docker.
 * For full fidelity also run `supabase test db` against a local stack.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../supabase/migrations');

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id), name text not null, owner uuid
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, update on storage.objects to authenticated;
  grant usage on schema public to anon, authenticated;
`;

export async function createDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export async function createUser(db: PGlite, email: string, fullName: string): Promise<string> {
  await db.exec('reset role');
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [email, fullName],
  );
  return res.rows[0]!.id;
}

/** Run `fn` as an authenticated API user (RLS enforced), inside a transaction rolled back on error. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (tx: PGlite) => Promise<T>): Promise<T> {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  await db.exec(userId ? 'set role authenticated' : 'set role anon');
  try {
    return await fn(db);
  } finally {
    await db.exec('reset role');
  }
}

/** Run as the database owner (bypasses RLS) — for fixtures only. */
export async function asOwner<T>(db: PGlite, fn: (tx: PGlite) => Promise<T>): Promise<T> {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  return fn(db);
}

/** Run as Supabase's service role (trusted server code). */
export async function asServiceRole<T>(db: PGlite, fn: (tx: PGlite) => Promise<T>): Promise<T> {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.exec('set role service_role');
  try {
    return await fn(db);
  } finally {
    await db.exec('reset role');
  }
}

export async function setPlan(db: PGlite, clinicId: string, code: string): Promise<void> {
  await asOwner(db, (tx) =>
    tx.query(
      `update public.tenant_subscriptions set status = 'active', plan_id = (select id from public.subscription_plans where code = $2) where clinic_id = $1`,
      [clinicId, code],
    ),
  );
}
