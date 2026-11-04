import { getSupabase } from '@/lib/supabase/client';
import type { EmploymentType, PermissionDefinition, RoleTemplate, StaffActivity, StaffDesignation, StaffMember, StaffPermissionRow, StaffStatus, UUID } from '@/types/domain';
import { unwrap } from './_helpers';

const STAFF_COLUMNS =
  'id, user_id, full_name, email, mobile, designation, designation_label, role_id, employee_code, employment_type, joined_on, status, invited_at, accepted_at, deactivated_at, deactivation_reason, created_at, assignments:staff_branch_assignments(branch_id)';

type StaffRow = Omit<StaffMember, 'branch_ids'> & { assignments: { branch_id: UUID }[] | null };
const toStaff = (r: StaffRow): StaffMember => {
  const { assignments, ...rest } = r;
  return { ...rest, branch_ids: (assignments ?? []).map((a) => a.branch_id) };
};

export async function listStaff(): Promise<StaffMember[]> {
  return unwrap<StaffRow[]>(await getSupabase().from('staff_members').select(STAFF_COLUMNS).order('full_name')).map(toStaff);
}

export async function getStaffMember(id: UUID): Promise<StaffMember> {
  return toStaff(unwrap<StaffRow>(await getSupabase().from('staff_members').select(STAFF_COLUMNS).eq('id', id).single()));
}

export interface StaffProfileInput {
  full_name: string;
  email: string;
  mobile?: string | null;
  designation: StaffDesignation;
  designation_label?: string | null;
  employee_code?: string | null;
  employment_type: EmploymentType;
  joined_on?: string | null;
}

/** Permission overrides keyed by permission: grant adds to the template, deny removes from it. */
export type Overrides = Record<string, 'grant' | 'deny'>;

export async function createStaffMember(input: { profile: StaffProfileInput; roleId: UUID; branchIds: UUID[]; overrides: Overrides }): Promise<StaffMember> {
  const row = unwrap<{ id: UUID }>(
    await getSupabase().rpc('create_staff_member', { p_profile: input.profile, p_role: input.roleId, p_branches: input.branchIds, p_overrides: input.overrides }),
  );
  return getStaffMember(row.id);
}

export async function updateStaffMember(id: UUID, profile: Partial<StaffProfileInput>): Promise<void> {
  unwrap(await getSupabase().rpc('update_staff_member', { p_staff: id, p_profile: profile }));
}

export async function setStaffAccess(id: UUID, roleId: UUID, overrides: Overrides): Promise<void> {
  unwrap(await getSupabase().rpc('set_staff_access', { p_staff: id, p_role: roleId, p_overrides: overrides }));
}

export async function setStaffBranches(id: UUID, branchIds: UUID[]): Promise<void> {
  unwrap(await getSupabase().rpc('set_staff_branches', { p_staff: id, p_branches: branchIds }));
}

export async function fetchStaffPermissionMatrix(id: UUID): Promise<StaffPermissionRow[]> {
  return unwrap<StaffPermissionRow[]>(await getSupabase().rpc('staff_permission_matrix', { p_staff: id }));
}

export async function fetchStaffActivity(from: string, to: string): Promise<StaffActivity[]> {
  return unwrap<StaffActivity[]>(await getSupabase().rpc('staff_activity', { p_from: from, p_to: to }));
}

/** Last recorded action per staff member (from the audit trail). */
export async function fetchStaffLastActivity(): Promise<Map<UUID, string | null>> {
  const rows = unwrap<{ staff_id: UUID; last_activity_at: string | null }[]>(await getSupabase().rpc('staff_last_activity'));
  return new Map(rows.map((r) => [r.staff_id, r.last_activity_at]));
}

export async function fetchPermissionCatalog(): Promise<PermissionDefinition[]> {
  return unwrap<PermissionDefinition[]>(await getSupabase().from('permissions').select('*').order('position'));
}

export async function listRoleTemplates(): Promise<RoleTemplate[]> {
  const rows = unwrap<(Omit<RoleTemplate, 'permissions'> & { role_permissions: { permission_key: string }[] | null })[]>(
    await getSupabase().from('roles').select('id, key, name, description, scope, is_system, default_designation, role_permissions(permission_key)').order('name'),
  );
  return rows.map(({ role_permissions, ...r }) => ({ ...r, permissions: (role_permissions ?? []).map((p) => p.permission_key) }));
}

export async function saveRoleTemplate(input: { id?: UUID; key: string; name: string; description: string | null; permissions: string[] }): Promise<void> {
  unwrap(await getSupabase().rpc('save_role_template', { p_id: input.id ?? null, p_key: input.key, p_name: input.name, p_description: input.description, p_permissions: input.permissions }));
}

export async function deleteRoleTemplate(id: UUID): Promise<void> {
  unwrap(await getSupabase().rpc('delete_role_template', { p_id: id }));
}

/** Calls the staff-admin Edge Function, surfacing only its safe message. */
async function staffAdmin(body: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabase().functions.invoke('staff-admin', { body });
  if (error) {
    // FunctionsHttpError carries the JSON body in `context`.
    const ctx = (error as { context?: Response }).context;
    const payload = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null) : null;
    throw { message: payload?.error ?? 'The request could not be completed', code: ctx?.status === 403 ? '42501' : ctx?.status === 429 ? '54000' : ctx?.status === 422 ? 'P0001' : undefined };
  }
}

export const sendStaffInvitation = (staffId: UUID) => staffAdmin({ action: 'invite', staffId });
export const sendStaffPasswordReset = (staffId: UUID) => staffAdmin({ action: 'reset_password', staffId });
export const setStaffStatus = (staffId: UUID, status: Exclude<StaffStatus, 'invited'>, reason?: string) => staffAdmin({ action: 'set_status', staffId, status, reason });
export const inviteAdministrator = (email: string, fullName: string) => staffAdmin({ action: 'invite_admin', email, fullName });
export const setAdministratorActive = (userId: UUID, active: boolean) => staffAdmin({ action: 'set_admin_status', userId, active });
