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
    `**Access.** ${a?.access ?? '—'}`,
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

/** Domain diagrams for the ERD. Audit columns (`created_by`, `updated_by` → auth.users) are omitted. */
const ERD_GROUPS: { title: string; tables: string[]; note?: string }[] = [
  { title: 'Organization, identity and access', tables: ['organization', 'clinic_settings', 'clinic_branches', 'branch_working_hours', 'user_profiles', 'staff_members', 'staff_branch_assignments', 'staff_permission_overrides', 'roles', 'role_permissions', 'permissions'] },
  { title: 'Patients and scheduling', tables: ['patients', 'patient_medical_profiles', 'patient_consents', 'appointments', 'follow_ups', 'clinic_branches', 'consultations'] },
  { title: 'Clinical records', tables: ['patients', 'consultations', 'ayurvedic_examinations', 'consultation_amendments', 'exam_field_definitions', 'prescriptions', 'prescription_items', 'prescription_revisions', 'prescription_templates', 'investigations', 'patient_documents', 'appointments', 'clinic_branches'] },
  { title: 'Billing', tables: ['patients', 'appointments', 'invoices', 'invoice_items', 'payments', 'refunds', 'clinic_branches'] },
  { title: 'Audit and notifications', tables: ['audit_events', 'notifications'], note: 'audit_events.entity_id and branch_id refer to rows of any table (polymorphic, no FK), so events outlive the rows they describe.' },
];

async function erd(db: PGlite, all: string[]): Promise<string> {
  const fks = await rows<{ child: string; parent: string; cols: string[]; nullable: boolean; unique: boolean }>(
    db,
    `select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
            array(select a.attname from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) as cols,
            bool_or(not a.attnotnull) as nullable,
            exists (select 1 from pg_constraint u where u.conrelid = c.conrelid and u.contype in ('u', 'p') and u.conkey <@ c.conkey) as unique
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     group by c.oid, c.conrelid, c.confrelid, c.conkey`,
  );
  const cols = await rows<{ table_name: string; column_name: string; data_type: string }>(
    db,
    `select table_name, column_name, case when data_type = 'ARRAY' then ltrim(udt_name, '_') || '[]' when data_type = 'USER-DEFINED' then udt_name else data_type end as data_type from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
  );
  const strip = (t: string) => t.replace(/^public\./, '');
  const out = [
    '# Vaidyora — Entity relationship diagrams',
    '',
    '> Generated by `npm run docs:db` from the migrations. Vaidyora holds one organization; tables have no tenant column. Visit-level rows carry `branch_id`.',
    '',
    `${all.length} tables. Field-level detail: [DATABASE.md](DATABASE.md).`,
    '',
  ];
  for (const g of ERD_GROUPS) {
    const set = new Set(g.tables.filter((t) => all.includes(t)));
    out.push(`## ${g.title}`, '', '```mermaid', 'erDiagram');
    for (const t of set) {
      const keyCols = cols.filter((c) => c.table_name === t && (c.column_name === 'id' || (c.column_name.endsWith('_id') && !['created_by', 'updated_by'].includes(c.column_name)) || ['status', 'account_type', 'code', 'key', 'effect', 'singleton'].includes(c.column_name)));
      out.push(`  ${t} {`);
      for (const c of keyCols.slice(0, 8)) out.push(`    ${c.data_type.replace(/\[\]$/, '_array').replace(/[^a-z_]+/gi, '_')} ${c.column_name}${c.column_name === 'id' ? ' PK' : c.column_name.endsWith('_id') ? ' FK' : ''}`);
      out.push('  }');
    }
    const seen = new Set<string>();
    for (const fk of fks) {
      const child = strip(fk.child);
      const parent = strip(fk.parent);
      if (!set.has(child) || !set.has(parent) || child === parent) continue;
      const label = fk.cols.join('_');
      const edge = `${parent}-${child}-${label}`;
      if (seen.has(edge)) continue;
      seen.add(edge);
      // Parent side: exactly one, or zero/one when the FK is nullable. Child side: zero or one (unique FK) or zero or more.
      const left = fk.nullable ? '|o' : '||';
      const right = fk.unique ? 'o|' : 'o{';
      out.push(`  ${parent} ${left}--${right} ${child} : "${label}"`);
    }
    out.push('```', '');
    if (g.note) out.push(`_${g.note}_`, '');
  }
  return out.join('\n');
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
    '- Event times are `timestamptz` (stored as UTC). Calendar dates such as `visit_date`, `issue_date` and `registered_on` are computed in `clinic_settings.timezone`, and the UI formats times in that time zone.',
    '- Money is `bigint` paise. No floating-point arithmetic is used for totals.',
    '- `created_at`/`updated_at` everywhere; `created_by`/`updated_by` on records people edit (`updated_by` is set by trigger from the JWT, never from the client).',
    '- Hard deletes are not granted except for `prescription_items` (draft only). Everything else is soft-deleted or status-driven, as described per table.',
    '- Multi-row writes run in a single transaction inside RPCs. RPCs marked **definer** perform their own permission checks; **invoker** RPCs run under the caller\'s RLS.',
    '',
    '## Tables',
    '',
    ...grouped.flatMap(({ g, tables: ts }) => (ts.length ? [`- **${g}:** ${ts.map((t) => `[\`${t}\`](#${t})`).join(', ')}`] : [])),
    '- **Private:** `private.counters` (sequence state) and `private.rate_limits`, not exposed through the API.',
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

  // Permission matrix (from role templates)
  const perms = await rows<{ key: string; label: string; sensitivity: string; doctor_only: boolean }>(db, `select key, label, sensitivity::text, doctor_only from public.permissions order by position`);
  const roleRows = await rows<{ key: string; name: string; scope: string }>(db, `select key, name, scope from public.roles order by scope, case key when 'primary_doctor' then 0 when 'admin' then 1 else 2 end, name`);
  const rp = await rows<{ role: string; permission: string }>(db, `select r.key as role, rp.permission_key as permission from public.role_permissions rp join public.roles r on r.id = rp.role_id`);
  const has = new Set(rp.map((r) => `${r.role}:${r.permission}`));
  const mark = (p: { sensitivity: string; doctor_only: boolean }) => (p.doctor_only ? ' 🩺' : p.sensitivity === 'clinical' ? ' ᶜ' : p.sensitivity === 'sensitive' ? ' ˢ' : '');
  const matrix = [
    '# Vaidyora — Permission matrix',
    '',
    '> Generated by `npm run docs:db` from `public.role_permissions`. Staff templates are defaults: Admin and Doctor can change them, and override any staff member\'s permissions individually (within their authority). The database enforces effective permissions in RLS and functions; the UI reads `my_access()` only to decide what to show.',
    '',
    '🩺 doctor-only (can never be granted to anyone else) · ᶜ clinical (sensitive) · ˢ sensitive (the UI asks for confirmation)',
    '',
    `| Permission | ${roleRows.map((r) => r.name).join(' | ')} |`,
    `| --- | ${roleRows.map(() => ':-:').join(' | ')} |`,
    ...perms.map((p) => `| \`${p.key}\` ${md(p.label)}${mark(p)} | ${roleRows.map((r) => (has.has(`${r.key}:${p.key}`) ? '✓' : '')).join(' | ')} |`),
    '',
    '## How effective access is decided',
    '',
    '1. **Identity:** the caller is signed in (`auth.uid()`) and their profile is active.',
    '2. **Account:** `primary_doctor` or `admin` use their account role; `staff` must have an **active** staff record (invited or deactivated staff have no access).',
    '3. **Permissions:** staff get `template ∪ grants − denies`, never doctor-only keys.',
    '4. **Branches:** doctor and admin act on every branch; staff only on assigned branches. Patient basic profiles are organization-wide; visits, bills, documents and clinical rows are branch-scoped.',
    '5. **Record rules:** finalized consultations and issued prescriptions are immutable; drafts are visible only to the doctor.',
    '',
    '## Guards',
    '',
    '- Exactly one organization and at most one primary doctor (unique constraints). The doctor is bound once by `bootstrap_primary_doctor` (service role) and can never be changed, deactivated or demoted.',
    '- Administrators are appointed through the `staff-admin` Edge Function after it verifies the caller is the primary doctor; only the doctor can deactivate them.',
    '- Staff records can be linked only to `staff` accounts, and only to an account with the invited email.',
    '- Nobody can change their own template, overrides, branches or status.',
    '- Doctor and admin may grant any non-doctor-only permission; staff with delegated `staff.permissions` may grant only what they hold, to staff whose branches are all theirs.',
    '- Every change writes an audit event with the permission keys granted and revoked.',
    '',
  ].join('\n');
  writeFileSync(join(ROOT, 'docs/PERMISSIONS.md'), matrix);
  writeFileSync(join(ROOT, 'docs/ERD.md'), await erd(db, tables));
  console.log(`Wrote docs/DATABASE.md (${tables.length} tables, ${fns.length} RPCs) and docs/PERMISSIONS.md`);
}

void main();
