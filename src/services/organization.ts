import { getSupabase } from '@/lib/supabase/client';
import { isPermission, type Permission } from '@/lib/permissions/permissions';
import type { AccountType, Branch, ClinicPreferences, Organization, OrganizationSettings, Profile, StaffDesignation, UUID, WorkingHours } from '@/types/domain';
import { unwrap } from './_helpers';

export interface BranchRef {
  id: UUID;
  code: string;
  name: string;
  is_primary: boolean;
}

export type AccessResult =
  | { account_type: null; reason: 'no_profile' | 'deactivated' | 'invited' | 'no_access' }
  | {
      account_type: AccountType;
      user_id: UUID;
      full_name: string;
      email: string | null;
      staff_id: UUID | null;
      designation: StaffDesignation | null;
      designation_label: string | null;
      permissions: Permission[];
      all_branches: boolean;
      branches: BranchRef[];
    };

/** The caller's effective access, evaluated by the database (UI uses it to shape screens only). */
export async function fetchMyAccess(): Promise<AccessResult> {
  const raw = unwrap<AccessResult & { permissions?: string[] }>(await getSupabase().rpc('my_access'));
  if (raw.account_type === null) return raw;
  return { ...raw, permissions: (raw.permissions ?? []).filter(isPermission) };
}

export async function acceptStaffInvitation(): Promise<void> {
  unwrap(await getSupabase().rpc('accept_staff_invitation'));
}

/** Client-reported session event (authoritative auth events live in Supabase's auth audit log). */
export async function logSessionEvent(event: 'session.signed_in' | 'session.signed_out'): Promise<void> {
  await getSupabase().rpc('log_session_event', { p_event: event });
}

export async function fetchOrganization(): Promise<Organization> {
  return unwrap<Organization>(await getSupabase().from('organization').select('*').single());
}

export type OrganizationUpdate = Partial<Omit<Organization, 'id' | 'logo_path' | 'primary_doctor_id'>>;

export async function updateOrganization(id: UUID, values: OrganizationUpdate): Promise<Organization> {
  return unwrap<Organization>(await getSupabase().from('organization').update(values).eq('id', id).select('*').single());
}

export async function fetchSettings(): Promise<OrganizationSettings> {
  return unwrap<OrganizationSettings>(await getSupabase().from('clinic_settings').select('*').single());
}

export type SettingsUpdate = Partial<Omit<OrganizationSettings, 'organization_id' | 'currency' | 'preferences'>> & { preferences?: ClinicPreferences };

export async function updateSettings(organizationId: UUID, values: SettingsUpdate): Promise<OrganizationSettings> {
  return unwrap<OrganizationSettings>(await getSupabase().from('clinic_settings').update(values).eq('organization_id', organizationId).select('*').single());
}

export async function fetchBranches(): Promise<Branch[]> {
  return unwrap<Branch[]>(await getSupabase().from('clinic_branches').select('*').order('is_primary', { ascending: false }).order('name'));
}

export type BranchInput = Pick<Branch, 'code' | 'name' | 'address_line' | 'city' | 'state' | 'pincode' | 'phone' | 'email' | 'is_active'> & { manager_staff_id?: UUID | null };

export async function saveBranch(values: BranchInput, id?: UUID): Promise<Branch> {
  const db = getSupabase().from('clinic_branches');
  const query = id ? db.update(values).eq('id', id) : db.insert(values);
  return unwrap<Branch>(await query.select('*').single());
}

export async function fetchBranchHours(branchId: UUID): Promise<WorkingHours[]> {
  const rows = unwrap<WorkingHours[]>(
    await getSupabase().from('branch_working_hours').select('weekday, opens_at, closes_at, slot_minutes').eq('branch_id', branchId).order('weekday').order('opens_at'),
  );
  return rows.map((r) => ({ ...r, opens_at: r.opens_at.slice(0, 5), closes_at: r.closes_at.slice(0, 5) }));
}

export async function saveBranchHours(branchId: UUID, hours: WorkingHours[]): Promise<void> {
  unwrap(await getSupabase().rpc('set_branch_hours', { p_branch: branchId, p_hours: hours }));
}

const PROFILE_COLUMNS = 'id, account_type, full_name, email, phone, preferred_locale, qualification, medical_registration_no, is_active';

export async function fetchProfile(userId: UUID): Promise<Profile> {
  return unwrap<Profile>(await getSupabase().from('user_profiles').select(PROFILE_COLUMNS).eq('id', userId).single());
}

export async function updateProfile(userId: UUID, values: Partial<Pick<Profile, 'full_name' | 'phone' | 'preferred_locale' | 'qualification' | 'medical_registration_no'>>): Promise<Profile> {
  return unwrap<Profile>(await getSupabase().from('user_profiles').update(values).eq('id', userId).select(PROFILE_COLUMNS).single());
}

/** The primary doctor's profile (name and registration for prints and headers). */
export async function fetchPrimaryDoctor(): Promise<Profile | null> {
  return unwrap<Profile | null>(await getSupabase().from('user_profiles').select(PROFILE_COLUMNS).eq('account_type', 'primary_doctor').maybeSingle());
}

/** Names for a set of user ids (colleagues in the organization). */
export async function fetchProfileNames(ids: UUID[]): Promise<Map<UUID, string>> {
  if (ids.length === 0) return new Map();
  const rows = unwrap<{ id: UUID; full_name: string }[]>(await getSupabase().from('user_profiles').select('id, full_name').in('id', [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

export async function fetchAdministrators(): Promise<Profile[]> {
  return unwrap<Profile[]>(await getSupabase().from('user_profiles').select(PROFILE_COLUMNS).eq('account_type', 'admin').order('full_name'));
}
