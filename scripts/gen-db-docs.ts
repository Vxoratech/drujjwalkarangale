/**
 * Generates docs/DATABASE.md and docs/PERMISSIONS.md from the real migrations.
 *   npm run docs:db
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createDatabase } from '../tests/db/harness';
import { SCHEMA_GROUP_ORDER, TABLES } from './schema-annotations';

const ROOT = join(import.meta.dirname, '..');

async function rows<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

const md = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n\s*/g, ' ');

async function tableSection(db: PGlite, table: string): Promise<string> {
  const a = TABLES[table];
  const cols = await rows<{ column_name: string; type: string; is_nullable: string; column_default: string | null }>(
    db,
    `select column_name, format_type(atttypid, atttypmod) as type, is_nullable, column_default
     from information_schema.columns c
     join pg_attribute a on a.attrelid = ('public.' || c.table_name)::regclass and a.attname = c.column_name
     where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table],
  );
  const cons = await rows<{ conname: string; contype: string; def: string }>(
    db,
    `select conname, contype, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = ('public.' || $1)::regclass order by contype, conname`,
    [table],
  );
  const idx = await rows<{ indexname: string; indexdef: string }>(db, `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1 order by 1`, [table]);
  const pols = await rows<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
    db,
    `select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = $1 order by cmd, policyname`,
    [table],
  );
  const grants = await rows<{ privilege_type: string }>(
    db,
    `select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' order by 1`,
    [table],
  );
  const colGrants = await rows<{ column_name: string }>(
    db,
    `select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' and privilege_type = 'UPDATE'
     except select column_name from information_schema.columns where false`,
    [table],
  );
  const triggers = await rows<{ tgname: string; fn: string }>(
    db,
    `select t.tgname, p.proname as fn from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = ('public.' || $1)::regclass and not t.tgisinternal order by 1`,
    [table],
  );

  const granted = new Set(grants.map((g) => g.privilege_type));
  const cmdLine = (cmd: string, priv: string) => {
    const p = pols.filter((x) => x.cmd === cmd || x.cmd === 'ALL');
    if (!granted.has(priv)) return `| ${cmd} | — | Not granted to \`authenticated\` (only via RPC/trusted code) |`;
    if (p.length === 0) return `| ${cmd} | — | Granted but no policy → denied by RLS |`;
    return p.map((x) => `| ${cmd} | \`${x.policyname}\` | ${md([x.qual && `USING ${x.qual}`, x.with_check && `CHECK ${x.with_check}`].filter(Boolean).join(' · '))} |`).join('\n');
  };
  const updateCols = granted.has('UPDATE') ? '' : colGrants.length ? ` Column-level UPDATE: ${colGrants.map((c) => `\`${c.column_name}\``).join(', ')}.` : '';

  const consName: Record<string, string> = { p: 'PK', f: 'FK', u: 'Unique', c: 'Check', x: 'Exclusion' };
  return [
    `### \`${table}\``,
    '',
    `**Purpose.** ${a?.purpose ?? '_Undocumented_'}`,
    '',
    `**Tenant scope.** ${a?.tenantScope ?? '—'}`,
    '',
    `**Retention and deletion.** ${a?.retention ?? '—'}`,
    a?.notes ? `\n**Notes.** ${a.notes}\n` : '',
    '<details><summary>Fields</summary>',
    '',
    '| Column | Type | Null | Default |',
    '| --- | --- | --- | --- |',
    ...cols.map((c) => `| \`${c.column_name}\` | ${md(c.type)} | ${c.is_nullable === 'YES' ? 'yes' : 'no'} | ${md(c.column_default) || ''} |`),
    '',
    '</details>',
    '',
    '<details><summary>Constraints and relationships</summary>',
    '',
    ...cons.map((c) => `- **${consName[c.contype] ?? c.contype}** \`${c.conname}\`: ${md(c.def)}`),
    '',
    '</details>',
    '',
    idx.length ? '<details><summary>Indexes</summary>\n\n' + idx.map((i) => `- ${md(i.indexdef.replace(/ ON public\.\w+ USING/, ' USING'))}`).join('\n') + '\n\n</details>\n' : '',
    triggers.length ? `**Triggers.** ${triggers.map((t) => `\`${t.tgname}\``).join(', ')}\n` : '',
    '**Row Level Security** (role `authenticated`; `anon` has no access).' + updateCols,
    '',
    '| Command | Policy | Rule |',
    '| --- | --- | --- |',
    cmdLine('SELECT', 'SELECT'),
    cmdLine('INSERT', 'INSERT'),
    cmdLine('UPDATE', 'UPDATE'),
    cmdLine('DELETE', 'DELETE'),
    '',
  ].join('\n');
}

async function main() {
  const db = await createDatabase();
  const tables = (await rows<{ relname: string }>(db, `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' order by 1`)).map((r) => r.relname);
  const fns = await rows<{ proname: string; secdef: boolean; args: string }>(
    db,
    `select p.proname, p.prosecdef as secdef, pg_get_function_identity_arguments(p.oid) as args
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`,
  );

  const grouped = SCHEMA_GROUP_ORDER.map((g) => ({ g, tables: tables.filter((t) => TABLES[t]?.group === g) }));
  const out: string[] = [
    '# Vaidyora — Database reference',
    '',
    '> Generated by `npm run docs:db` from `supabase/migrations`. Do not edit by hand; edit `scripts/schema-annotations.ts` or the migrations.',
    '',
    '## Conventions',
    '',
    '- UUID primary keys (`gen_random_uuid()`); human-readable numbers (`P-000001`, `INV-2026-000001`, `RX-…`, `RCPT-…`, `RFND-…`) come from atomic per-clinic counters.',
    '- Event times are `timestamptz` (stored as UTC). Calendar dates such as `visit_date`, `issue_date` and `registered_on` are computed in the clinic\'s `timezone`, and the UI formats times in that time zone.',
    '- Money is `bigint` paise. No floating-point arithmetic is used for totals.',
    '- `created_at`/`updated_at` everywhere; `created_by`/`updated_by` on records people edit (`updated_by` is set by trigger from the JWT, never from the client).',
    '- Every tenant table has `clinic_id`, immutable after insert, and composite foreign keys `(x_id, clinic_id)` so rows cannot reference another tenant.',
    '- Hard deletes are not granted except for `prescription_items` (draft only) and `member_branches`. Everything else is soft-deleted or status-driven, as described per table.',
    '- Multi-row writes run in a single transaction inside RPCs. RPCs marked **definer** perform their own permission checks; **invoker** RPCs run under the caller\'s RLS.',
    '',
    '## Tables',
    '',
    ...grouped.flatMap(({ g, tables: ts }) => (ts.length ? [`- **${g}:** ${ts.map((t) => `[\`${t}\`](#${t})`).join(', ')}`] : [])),
    '- **Private:** `private.clinic_counters` (sequence state, not exposed through the API).',
    '',
  ];
  for (const { g, tables: ts } of grouped) {
    if (!ts.length) continue;
    out.push(`## ${g}`, '');
    for (const t of ts) out.push(await tableSection(db, t));
  }
  out.push(
    '## RPC functions (`public` schema)',
    '',
    '| Function | Rights | Arguments |',
    '| --- | --- | --- |',
    ...fns.map((f) => `| \`${f.proname}\` | ${f.secdef ? 'definer' : 'invoker'} | ${md(f.args)} |`),
    '',
  );
  writeFileSync(join(ROOT, 'docs/DATABASE.md'), out.join('\n'));

  // Permission matrix
  const perms = await rows<{ key: string; description: string }>(db, `select key, description from public.permissions order by key`);
  const rp = await rows<{ role: string; permission: string }>(db, `select role::text, permission from public.role_permissions`);
  const roles = ['admin', 'doctor', 'receptionist', 'accountant', 'pharmacist', 'branch_manager'];
  const has = new Set(rp.map((r) => `${r.role}:${r.permission}`));
  const matrix = [
    '# Vaidyora — Role permission matrix',
    '',
    '> Generated by `npm run docs:db` from `public.role_permissions`. Admin and Doctor are enabled in the UI today; the other roles are already configured and can be enabled by allowing them in `ASSIGNABLE_ROLES` (`src/types/domain.ts`), with no schema change.',
    '',
    'Permissions are granted per membership (a user can hold different roles in different clinics, and several roles in one clinic). The database enforces them in RLS policies and RPCs. The UI reads `my_permissions()` only to decide what to show.',
    '',
    `| Permission | Description | ${roles.map((r) => r.replace('_', ' ')).join(' | ')} |`,
    `| --- | --- | ${roles.map(() => ':-:').join(' | ')} |`,
    ...perms.map((p) => `| \`${p.key}\` | ${md(p.description)} | ${roles.map((r) => (has.has(`${r}:${p.key}`) ? '✓' : '')).join(' | ')} |`),
    '',
    '## Platform (Super Admin) boundary',
    '',
    '- Platform operators are rows in `public.platform_admins` (roles `owner`, `support`), created only with SQL or the service role, never from the app.',
    '- They are **not** clinic members and hold **no** tenant permissions: RLS gives them no patient, clinical or billing rows.',
    '- Their only capabilities are the `platform_*` RPCs: list clinics with metadata and counts (support/owner), and set a clinic\'s status or plan (owner). Platform actions are written to `audit_events` with `actor_type = platform`.',
    '- `super_admin` in `app_role` is reserved and has no clinic grants. Platform authority never comes from a clinic role.',
    '',
    '## Clinical separation',
    '',
    '- An **Admin** who is not also a **Doctor** manages patients, schedule, billing and settings but cannot read consultation notes, examinations, prescriptions, investigations or documents.',
    '- A **Doctor** sees only patients assigned to them or booked with them, and writes only their own clinical records.',
    '- **Branch scope** (`member_branches`) further restricts appointments, consultations and invoices to the listed branches.',
    '',
  ].join('\n');
  writeFileSync(join(ROOT, 'docs/PERMISSIONS.md'), matrix);
  console.log(`Wrote docs/DATABASE.md (${tables.length} tables, ${fns.length} RPCs) and docs/PERMISSIONS.md`);
}

void main();
