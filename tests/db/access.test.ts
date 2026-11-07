import { beforeAll, describe, expect, it } from 'vitest';
import { asOwner, asServiceRole, asUser, createUser } from './harness';
import { addStaff, count, createInvitedStaff, createWorld, expectError, roleId, type World } from './world';

let w: World;
beforeAll(async () => {
  w = await createWorld();
});

const access = (user: string) =>
  asUser(w.db, user, async (tx) => (await tx.query<{ my_access: Record<string, unknown> }>(`select public.my_access()`)).rows[0]!.my_access);

describe('single organization', () => {
  it('has exactly one organization row and refuses a second one', async () => {
    expect(await count(w.db, w.doctor, 'select 1 from public.organization')).toBe(1);
    await expectError(() => asOwner(w.db, (tx) => tx.query(`insert into public.organization (name) values ('Another clinic')`)), '23505');
    await expectError(() => asOwner(w.db, (tx) => tx.query(`delete from public.organization`)), '42501');
  });

  it('exposes no clinic-registration or tenant functions', async () => {
    const fns = await asOwner(w.db, async (tx) =>
      (await tx.query<{ proname: string }>(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows.map((r) => r.proname),
    );
    for (const gone of ['create_clinic', 'accept_invitation', 'platform_list_clinics', 'platform_assign_plan']) expect(fns).not.toContain(gone);
    const tables = await asOwner(w.db, async (tx) =>
      (await tx.query<{ relname: string }>(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r'`)).rows.map((r) => r.relname),
    );
    for (const gone of ['clinics', 'clinic_members', 'subscription_plans', 'tenant_subscriptions', 'platform_admins']) expect(tables).not.toContain(gone);
  });

  it('lets only the organization-settings permission edit the organization', async () => {
    await asUser(w.db, w.admin, (tx) => tx.query(`update public.organization set phone = '+91 20 1234 5678'`));
    const changed = await asUser(w.db, w.doctor, async (tx) => (await tx.query(`update public.organization set phone = '+91 20 0000 0000'`)).affectedRows);
    expect(changed).toBe(0); // doctor's settings access is restricted
  });
});

describe('the primary doctor', () => {
  it('is bound once and cannot be replaced', async () => {
    const other = await createUser(w.db, 'second.doctor@demo.vaidyora.test', 'Second Doctor');
    await expectError(() => asServiceRole(w.db, (tx) => tx.query(`select public.bootstrap_primary_doctor('second.doctor@demo.vaidyora.test')`)), '42501', /already set/);
    await expectError(() => asOwner(w.db, (tx) => tx.query(`update public.organization set primary_doctor_id = $1`, [other])), '42501');
    expect(await count(w.db, w.admin, `select 1 from public.user_profiles where account_type = 'primary_doctor'`)).toBe(1);
  });

  it('cannot be created through a profile update, even by the database owner', async () => {
    const user = await createUser(w.db, 'sneaky@demo.vaidyora.test', 'Sneaky');
    await expectError(() => asUser(w.db, user, (tx) => tx.query(`update public.user_profiles set account_type = 'primary_doctor' where id = $1`, [user])), '42501');
    await expectError(() => asOwner(w.db, (tx) => tx.query(`update public.user_profiles set account_type = 'admin' where id = $1`, [user])), '42501');
    await expectError(
      () => asOwner(w.db, async (tx) => {
        await tx.query(`select set_config('vaidyora.identity_op', 'on', false)`);
        try {
          await tx.query(`update public.user_profiles set account_type = 'primary_doctor' where id = $1`, [user]);
        } finally {
          await tx.query(`select set_config('vaidyora.identity_op', 'off', false)`);
        }
      }),
      '23505', // the unique index still allows only one primary doctor
    );
  });

  it('cannot be deactivated or turned into another account type', async () => {
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`select public.set_admin_active($1, false)`, [w.doctor])), '42501');
    await expectError(() => asServiceRole(w.db, (tx) => tx.query(`select public.link_admin_account($1)`, [w.doctor])), '42501');
  });

  it('holds every doctor-only permission, and nobody else does', async () => {
    const doctorOnly = await asOwner(w.db, async (tx) => (await tx.query<{ key: string }>(`select key from public.permissions where doctor_only`)).rows.map((r) => r.key));
    expect(doctorOnly).toEqual(expect.arrayContaining(['consultations.create', 'consultations.edit', 'prescriptions.create', 'prescriptions.finalize', 'examinations.edit', 'investigations.order']));
    const doctorPerms = (await access(w.doctor)).permissions as string[];
    for (const k of doctorOnly) expect(doctorPerms).toContain(k);
    for (const user of [w.admin, w.receptionist.userId, w.manager.userId, w.accountant.userId]) {
      const perms = (await access(user)).permissions as string[];
      expect(perms.filter((k) => doctorOnly.includes(k))).toEqual([]);
    }
  });
});

describe('administrators', () => {
  it('are appointed by trusted code and managed only by the doctor', async () => {
    expect((await access(w.admin)).account_type).toBe('admin');
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`select public.set_admin_active($1, false)`, [w.admin])), '42501');
    const second = await createUser(w.db, 'admin2@demo.vaidyora.test', 'Second Admin');
    await asServiceRole(w.db, (tx) => tx.query(`select public.link_admin_account($1)`, [second]));
    await asUser(w.db, w.doctor, (tx) => tx.query(`select public.set_admin_active($1, false)`, [second]));
    expect((await access(second)).account_type).toBeNull();
    expect((await access(second)).reason).toBe('deactivated');
  });

  it('cannot be granted from a staff account or a staff record', async () => {
    await expectError(() => asServiceRole(w.db, (tx) => tx.query(`select public.link_admin_account($1)`, [w.receptionist.userId])), '42501');
  });
});

describe('role templates and overrides', () => {
  it('reject doctor-only permissions in staff templates and overrides', async () => {
    const reception = await roleId(w.db, 'receptionist');
    await expectError(() => asOwner(w.db, (tx) => tx.query(`insert into public.role_permissions values ($1, 'consultations.edit')`, [reception])), '42501');
    await expectError(() => asOwner(w.db, (tx) => tx.query(`insert into public.staff_permission_overrides (staff_id, permission_key, effect) values ($1, 'prescriptions.finalize', 'grant')`, [w.receptionist.staffId])), '42501');
    await expectError(
      () => asUser(w.db, w.admin, (tx) => tx.query(`select public.set_staff_access($1, $2, '{"consultations.create":"grant"}'::jsonb)`, [w.receptionist.staffId, reception])),
      '42501',
    );
  });

  it('cannot place staff on the doctor or admin account roles', async () => {
    const adminRole = await roleId(w.db, 'admin');
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`select public.set_staff_access($1, $2, '{}'::jsonb)`, [w.receptionist.staffId, adminRole])), '23503');
  });

  it('keeps account roles fixed from the API', async () => {
    const adminRole = await roleId(w.db, 'admin');
    await expectError(
      () => asUser(w.db, w.admin, (tx) => tx.query(`select public.save_role_template($1, 'admin', 'Administrator', null, array['audit.view'])`, [adminRole])),
      'P0002',
    );
  });

  it('applies grants and denies on top of the template', async () => {
    const reception = await roleId(w.db, 'receptionist');
    await asUser(w.db, w.admin, (tx) =>
      tx.query(`select public.set_staff_access($1, $2, '{"billing.view":"grant","appointments.cancel":"deny"}'::jsonb)`, [w.receptionist.staffId, reception]),
    );
    const perms = (await access(w.receptionist.userId)).permissions as string[];
    expect(perms).toContain('billing.view');
    expect(perms).not.toContain('appointments.cancel');
    const events = await count(w.db, w.admin, `select 1 from public.audit_events where event_type = 'staff.permissions_changed' and entity_id = $1
      and metadata -> 'granted' ? 'billing.view' and metadata -> 'revoked' ? 'appointments.cancel'`, [w.receptionist.staffId]);
    expect(events).toBe(1);
    await asUser(w.db, w.admin, (tx) => tx.query(`select public.set_staff_access($1, $2, '{}'::jsonb)`, [w.receptionist.staffId, reception]));
  });

  it('explains effective permissions for the editor', async () => {
    const rows = await asUser(w.db, w.admin, async (tx) =>
      (await tx.query<{ permission_key: string; in_template: boolean; effective: boolean; grantable: boolean }>(`select * from public.staff_permission_matrix($1)`, [w.receptionist.staffId])).rows,
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.permission_key, r]));
    expect(byKey['patients.create']).toMatchObject({ in_template: true, effective: true });
    expect(byKey['consultations.view']).toMatchObject({ in_template: false, effective: false });
    expect(byKey['consultations.edit']!.grantable).toBe(false);
  });

  it('protects built-in templates and templates in use', async () => {
    const reception = await roleId(w.db, 'receptionist');
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`select public.delete_role_template($1)`, [reception])), '42501', /Built-in/);
    const custom = await asUser(w.db, w.admin, async (tx) =>
      (await tx.query<{ id: string }>(`select id from public.save_role_template(null, 'lab_assistant', 'Lab Assistant', 'Uploads reports', array['patients.view_basic', 'investigations.upload'])`)).rows[0]!.id,
    );
    await asUser(w.db, w.admin, (tx) => tx.query(`select public.delete_role_template($1)`, [custom]));
  });
});

describe('no self-elevation and no escalation', () => {
  it('stops staff from editing their own access', async () => {
    const manager = await roleId(w.db, 'branch_manager');
    // A branch manager with staff powers still cannot touch their own record.
    await asUser(w.db, w.doctor, (tx) =>
      tx.query(`select public.set_staff_access($1, $2, '{"staff.manage":"grant","staff.permissions":"grant"}'::jsonb)`, [w.manager.staffId, manager]),
    );
    await expectError(() => asUser(w.db, w.manager.userId, (tx) => tx.query(`select public.set_staff_access($1, $2, '{"audit.view":"grant"}'::jsonb)`, [w.manager.staffId, manager])), '42501');
    await expectError(() => asUser(w.db, w.manager.userId, (tx) => tx.query(`select public.set_staff_branches($1, $2::uuid[])`, [w.manager.staffId, [w.dhanori, w.main]])), '42501');
    await expectError(() => asUser(w.db, w.manager.userId, (tx) => tx.query(`update public.staff_members set role_id = role_id where id = $1`, [w.manager.staffId])), '42501');
  });

  it('lets delegated managers grant only what they hold, at their own branches', async () => {
    const reception = await roleId(w.db, 'receptionist');
    await expectError(
      () => asUser(w.db, w.manager.userId, (tx) => tx.query(`select public.set_staff_access($1, $2, '{"audit.view":"grant"}'::jsonb)`, [w.dhanoriReception.staffId, reception])),
      '42501', /within your own authority/,
    );
    await asUser(w.db, w.manager.userId, (tx) =>
      tx.query(`select public.set_staff_access($1, $2, '{"billing.view":"grant"}'::jsonb)`, [w.dhanoriReception.staffId, reception]),
    );
    // Main-branch staff are outside the Dhanori manager's authority.
    await expectError(() => asUser(w.db, w.manager.userId, (tx) => tx.query(`select public.set_staff_access($1, $2, '{}'::jsonb)`, [w.receptionist.staffId, reception])), '42501');
    await expectError(
      () => createInvitedStaff(w.db, w.manager.userId, { email: 'mainhire@demo.vaidyora.test', name: 'Main Hire', role: 'receptionist', branches: [w.main] }),
      '42501', /branches you manage/,
    );
  });

  it('keeps staff tables closed to direct writes', async () => {
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`insert into public.staff_branch_assignments (staff_id, branch_id) values ($1, $2)`, [w.receptionist.staffId, w.dhanori])), '42501');
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`insert into public.staff_permission_overrides (staff_id, permission_key, effect) values ($1, 'audit.view', 'grant')`, [w.receptionist.staffId])), '42501');
  });
});

describe('staff lifecycle', () => {
  it('gives invited staff no access until they accept', async () => {
    const staffId = await createInvitedStaff(w.db, w.admin, { email: 'newhire@demo.vaidyora.test', name: 'New Hire', role: 'assistant', branches: [w.main] });
    const user = await createUser(w.db, 'newhire@demo.vaidyora.test', 'New Hire');
    await asServiceRole(w.db, (tx) => tx.query(`select public.link_staff_account($1, $2)`, [staffId, user]));
    expect((await access(user)).reason).toBe('invited');
    expect(await count(w.db, user, 'select 1 from public.patients')).toBe(0);
    await asUser(w.db, user, (tx) => tx.query(`select public.accept_staff_invitation()`));
    expect((await access(user)).account_type).toBe('staff');
  });

  it('refuses to link an account whose email differs from the staff record', async () => {
    const staffId = await createInvitedStaff(w.db, w.admin, { email: 'right@demo.vaidyora.test', name: 'Right Person', role: 'assistant', branches: [w.main] });
    const wrong = await createUser(w.db, 'wrong@demo.vaidyora.test', 'Wrong Person');
    await expectError(() => asServiceRole(w.db, (tx) => tx.query(`select public.link_staff_account($1, $2)`, [staffId, wrong])), '42501');
  });

  it('refuses staff records for the doctor or an admin email', async () => {
    await expectError(
      () => createInvitedStaff(w.db, w.admin, { email: 'dr.ujjwal@demo.vaidyora.test', name: 'Imposter', role: 'receptionist', branches: [w.main] }),
      '23505',
    );
    await expectError(() => asServiceRole(w.db, async (tx) => {
      const id = (await tx.query<{ id: string }>(`select id from public.staff_members where email = 'priya@demo.vaidyora.test'`)).rows[0]!.id;
      await tx.query(`update public.staff_members set user_id = null where id = $1`, [id]);
    }), '42501');
  });

  it('removes all access when staff are deactivated, with a reason', async () => {
    const temp = await addStaff(w.db, w.admin, { email: 'temp@demo.vaidyora.test', name: 'Temp Worker', role: 'receptionist', branches: [w.main] });
    expect(await count(w.db, temp.userId, 'select 1 from public.clinic_branches')).toBeGreaterThan(0);
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`select public.set_staff_status($1, 'inactive')`, [temp.staffId])), '23514');
    await asUser(w.db, w.admin, (tx) => tx.query(`select public.set_staff_status($1, 'inactive', 'Contract ended')`, [temp.staffId]));
    expect((await access(temp.userId)).account_type).toBeNull();
    expect(await count(w.db, temp.userId, 'select 1 from public.clinic_branches')).toBe(0);
    await asUser(w.db, w.admin, (tx) => tx.query(`select public.set_staff_status($1, 'active')`, [temp.staffId]));
    expect((await access(temp.userId)).account_type).toBe('staff');
  });
});

describe('branch scope', () => {
  it('lists only assigned branches for staff and all for doctor and admin', async () => {
    const names = async (u: string) => ((await access(u)).branches as { code: string }[]).map((b) => b.code).sort();
    expect(await names(w.doctor)).toEqual(['DHN', 'MAIN']);
    expect(await names(w.admin)).toEqual(['DHN', 'MAIN']);
    expect(await names(w.receptionist.userId)).toEqual(['MAIN']);
    expect(await names(w.manager.userId)).toEqual(['DHN']);
  });

  it('lets branch managers see only staff who share a branch', async () => {
    const visible = await asUser(w.db, w.manager.userId, async (tx) => (await tx.query<{ email: string }>(`select email from public.staff_members order by email`)).rows.map((r) => r.email));
    expect(visible).toContain('ravi@demo.vaidyora.test');
    expect(visible).not.toContain('priya@demo.vaidyora.test');
  });

  it('limits branch-settings holders to contact details of their branch', async () => {
    await asUser(w.db, w.manager.userId, (tx) => tx.query(`update public.clinic_branches set phone = '+91 20 5555 0000' where id = $1`, [w.dhanori]));
    expect(await asUser(w.db, w.manager.userId, async (tx) => (await tx.query(`update public.clinic_branches set phone = '+91 20 5555 0001' where id = $1`, [w.main])).affectedRows)).toBe(0);
    await expectError(() => asUser(w.db, w.manager.userId, (tx) => tx.query(`update public.clinic_branches set is_active = false where id = $1`, [w.dhanori])), '42501');
  });

  it('manages working hours and rejects overlaps', async () => {
    await expectError(
      () => asUser(w.db, w.admin, (tx) => tx.query(`select public.set_branch_hours($1, $2::jsonb)`, [w.dhanori, JSON.stringify([
        { weekday: 1, opens_at: '09:00', closes_at: '13:00' }, { weekday: 1, opens_at: '12:00', closes_at: '18:00' }])])),
      '23514',
    );
    await asUser(w.db, w.manager.userId, (tx) => tx.query(`select public.set_branch_hours($1, $2::jsonb)`, [w.dhanori, JSON.stringify([
      { weekday: 1, opens_at: '09:00', closes_at: '13:00' }, { weekday: 1, opens_at: '16:00', closes_at: '20:00' }])]));
    expect(await count(w.db, w.doctor, `select 1 from public.branch_working_hours where branch_id = $1`, [w.dhanori])).toBe(2);
  });

  it('never lets the primary branch be deactivated', async () => {
    await expectError(() => asUser(w.db, w.admin, (tx) => tx.query(`update public.clinic_branches set is_active = false where id = $1`, [w.main])), '23514');
  });
});

describe('accounts without access', () => {
  it('see nothing at all', async () => {
    const stranger = await createUser(w.db, 'stranger@example.test', 'Stranger');
    expect((await access(stranger)).account_type).toBeNull();
    for (const t of ['organization', 'clinic_branches', 'patients', 'appointments', 'staff_members', 'roles', 'audit_events']) {
      expect(await count(w.db, stranger, `select 1 from public.${t}`), t).toBe(0);
    }
    await expectError(() => asUser(w.db, stranger, (tx) => tx.query(`select public.create_staff_member('{}'::jsonb, null, '{}'::uuid[])`)), '42501');
  });

  it('and anonymous callers can call nothing', async () => {
    await expectError(() => asUser(w.db, null, (tx) => tx.query(`select public.my_access()`)), '42501');
    await expectError(() => asUser(w.db, null, (tx) => tx.query(`select * from public.patients`)), '42501');
  });
});
