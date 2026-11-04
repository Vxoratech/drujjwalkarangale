/**
 * A fictional organization for database tests: Dr. Ujjwal (primary doctor),
 * an administrator, two branches and staff with different templates.
 * Everything is created through the same functions the app uses.
 */
import type { PGlite } from '@electric-sql/pglite';
import { asOwner, asServiceRole, asUser, createDatabase, createUser } from './harness';

export interface StaffFixture {
  staffId: string;
  userId: string;
}

export interface World {
  db: PGlite;
  doctor: string;
  admin: string;
  main: string;
  dhanori: string;
  receptionist: StaffFixture; // Main only
  accountant: StaffFixture; // Main only
  manager: StaffFixture; // Dhanori branch manager
  dhanoriReception: StaffFixture; // Dhanori only
}

export async function roleId(db: PGlite, key: string): Promise<string> {
  return asOwner(db, async (tx) => (await tx.query<{ id: string }>(`select id from public.roles where key = $1`, [key])).rows[0]!.id);
}

export async function createInvitedStaff(
  db: PGlite,
  actor: string,
  opts: { email: string; name: string; role: string; branches: string[]; designation?: string; overrides?: Record<string, 'grant' | 'deny'> },
): Promise<string> {
  const role = await roleId(db, opts.role);
  return asUser(db, actor, async (tx) =>
    (await tx.query<{ id: string }>(
      `select id from public.create_staff_member($1::jsonb, $2, $3::uuid[], $4::jsonb)`,
      [JSON.stringify({ full_name: opts.name, email: opts.email, designation: opts.designation ?? opts.role }), role, opts.branches, JSON.stringify(opts.overrides ?? {})],
    )).rows[0]!.id,
  );
}

/** Invite → account created by the Edge Function → link → accept. */
export async function addStaff(
  db: PGlite,
  actor: string,
  opts: { email: string; name: string; role: string; branches: string[]; designation?: string; overrides?: Record<string, 'grant' | 'deny'> },
): Promise<StaffFixture> {
  const staffId = await createInvitedStaff(db, actor, opts);
  const userId = await createUser(db, opts.email, opts.name);
  await asServiceRole(db, (tx) => tx.query(`select public.link_staff_account($1, $2)`, [staffId, userId]));
  await asUser(db, userId, (tx) => tx.query(`select public.accept_staff_invitation()`));
  return { staffId, userId };
}

export async function createWorld(): Promise<World> {
  const db = await createDatabase();
  const doctor = await createUser(db, 'dr.ujjwal@demo.vaidyora.test', 'Dr. Ujjwal Karangale');
  await asServiceRole(db, (tx) => tx.query(`select public.bootstrap_primary_doctor('dr.ujjwal@demo.vaidyora.test')`));
  const admin = await createUser(db, 'admin@demo.vaidyora.test', 'Asha Admin');
  await asServiceRole(db, (tx) => tx.query(`select public.link_admin_account($1)`, [admin]));

  const main = await asOwner(db, async (tx) => (await tx.query<{ id: string }>(`select id from public.clinic_branches where code = 'MAIN'`)).rows[0]!.id);
  const dhanori = await asUser(db, admin, async (tx) =>
    (await tx.query<{ id: string }>(`insert into public.clinic_branches (code, name, city) values ('DHN', 'Dhanori Branch', 'Pune') returning id`)).rows[0]!.id,
  );

  const receptionist = await addStaff(db, admin, { email: 'priya@demo.vaidyora.test', name: 'Priya Sharma', role: 'receptionist', branches: [main] });
  const accountant = await addStaff(db, admin, { email: 'kiran@demo.vaidyora.test', name: 'Kiran Accounts', role: 'accountant', branches: [main] });
  const manager = await addStaff(db, doctor, { email: 'meena@demo.vaidyora.test', name: 'Meena Manager', role: 'branch_manager', branches: [dhanori] });
  const dhanoriReception = await addStaff(db, admin, { email: 'ravi@demo.vaidyora.test', name: 'Ravi Front Desk', role: 'receptionist', branches: [dhanori] });
  return { db, doctor, admin, main, dhanori, receptionist, accountant, manager, dhanoriReception };
}

/** Registers a fictional patient as `actor` at `branch`. */
export async function registerPatient(db: PGlite, actor: string, branch: string, first: string, extra: Record<string, unknown> = {}): Promise<string> {
  return asUser(db, actor, async (tx) =>
    (await tx.query<{ id: string }>(`select id from public.register_patient($1::jsonb, $2, true)`, [JSON.stringify({ first_name: first, last_name: 'Test', ...extra }), branch])).rows[0]!.id,
  );
}

let slot = 0;
/** Books a non-overlapping appointment (all appointments share Dr. Ujjwal's calendar). */
export async function book(db: PGlite, actor: string, branch: string, patient: string, start?: Date): Promise<string> {
  const startsAt = start ?? new Date(Date.UTC(2026, 10, 10, 4, 0) + slot++ * 30 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 15 * 60_000);
  return asUser(db, actor, async (tx) =>
    (await tx.query<{ id: string }>(
      `insert into public.appointments (branch_id, patient_id, starts_at, ends_at) values ($1, $2, $3, $4) returning id`,
      [branch, patient, startsAt.toISOString(), endsAt.toISOString()],
    )).rows[0]!.id,
  );
}

/** Doctor starts a consultation for a patient at a branch. */
export async function consult(db: PGlite, doctor: string, branch: string, patient: string, appointment?: string): Promise<string> {
  return asUser(db, doctor, async (tx) =>
    (await tx.query<{ save_consultation: string }>(`select public.save_consultation(null, $1::jsonb, $2::jsonb)`, [
      JSON.stringify({ patient_id: patient, branch_id: branch, appointment_id: appointment ?? null, chief_complaint: 'Joint pain for two weeks', treatment_plan: 'Abhyanga' }),
      JSON.stringify({ prakriti: 'vata_pitta', nadi: 'Vata predominant' }),
    ])).rows[0]!.save_consultation,
  );
}

export async function count(db: PGlite, actor: string | null, sql: string, params: unknown[] = []): Promise<number> {
  return asUser(db, actor, async (tx) => (await tx.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params)).rows[0]!.n);
}

/** Expects the statement to fail with the given SQLSTATE (and optional message fragment). */
export async function expectError(fn: () => Promise<unknown>, code: string, message?: RegExp): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const e = error as { code?: string; message: string };
    if (e.code !== code) throw new Error(`Expected SQLSTATE ${code}, got ${e.code}: ${e.message}`);
    if (message && !message.test(e.message)) throw new Error(`Unexpected message: ${e.message}`);
    return;
  }
  throw new Error(`Expected SQLSTATE ${code}, but the statement succeeded`);
}
