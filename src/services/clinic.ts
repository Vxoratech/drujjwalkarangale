import { getSupabase } from '@/lib/supabase/client';
import { isPermission, type Permission } from '@/lib/permissions/permissions';
import type { AppRole, Branch, Clinic, Membership, Profile, StaffMember, UUID } from '@/types/domain';
import { unwrap } from './_helpers';

export async function fetchMemberships(userId: UUID): Promise<Membership[]> {
  return unwrap<Membership[]>(
    await getSupabase()
      .from('clinic_members')
      .select('id, clinic_id, user_id, roles, status, default_branch_id, clinic:clinics(id, name, city, logo_path, status, status_reason)')
      .eq('user_id', userId)
      .in('status', ['active', 'invited'])
      .order('created_at'),
  );
}

export async function acceptInvitation(clinicId: UUID): Promise<void> {
  unwrap(await getSupabase().rpc('accept_invitation', { p_clinic: clinicId }));
}

/** Client-reported session event (authoritative auth events live in Supabase's auth audit log). */
export async function logSessionEvent(clinicId: UUID, event: 'session.signed_in' | 'session.clinic_selected' | 'session.signed_out'): Promise<void> {
  await getSupabase().rpc('log_session_event', { p_clinic: clinicId, p_event: event });
}

export async function fetchMemberBranches(clinicId: UUID): Promise<Map<UUID, UUID[]>> {
  const rows = unwrap<{ member_id: UUID; branch_id: UUID }[]>(await getSupabase().from('member_branches').select('member_id, branch_id').eq('clinic_id', clinicId));
  const map = new Map<UUID, UUID[]>();
  for (const r of rows) map.set(r.member_id, [...(map.get(r.member_id) ?? []), r.branch_id]);
  return map;
}

/** Replace a member's branch scope (empty = all branches). */
export async function setMemberBranches(clinicId: UUID, memberId: UUID, branchIds: UUID[]): Promise<void> {
  const db = getSupabase();
  unwrap(await db.from('member_branches').delete().eq('member_id', memberId).select('member_id'));
  if (branchIds.length > 0) {
    unwrap(await db.from('member_branches').insert(branchIds.map((branch_id) => ({ member_id: memberId, clinic_id: clinicId, branch_id }))).select('member_id'));
  }
}

export async function fetchPermissions(clinicId: UUID): Promise<Permission[]> {
  const rows = unwrap<string[]>(await getSupabase().rpc('my_permissions', { p_clinic: clinicId }));
  return rows.filter(isPermission);
}

export async function fetchClinic(clinicId: UUID): Promise<Clinic> {
  return unwrap<Clinic>(await getSupabase().from('clinics').select('*').eq('id', clinicId).single());
}

export type ClinicUpdate = Partial<Omit<Clinic, 'id' | 'currency' | 'logo_path' | 'status' | 'status_reason' | 'settings'>>;

export async function updateClinic(clinicId: UUID, values: ClinicUpdate): Promise<Clinic> {
  return unwrap<Clinic>(await getSupabase().from('clinics').update(values).eq('id', clinicId).select('*').single());
}

export async function createClinic(input: { name: string; city: string; phone: string; isPractitioner: boolean }): Promise<UUID> {
  return unwrap<UUID>(
    await getSupabase().rpc('create_clinic', {
      p_name: input.name,
      p_city: input.city,
      p_phone: input.phone,
      p_is_practitioner: input.isPractitioner,
    }),
  );
}

export async function fetchBranches(clinicId: UUID): Promise<Branch[]> {
  return unwrap<Branch[]>(await getSupabase().from('branches').select('*').eq('clinic_id', clinicId).order('is_primary', { ascending: false }).order('name'));
}

export async function saveBranch(clinicId: UUID, values: Pick<Branch, 'name' | 'address_line' | 'city' | 'phone' | 'is_active'>, id?: UUID): Promise<Branch> {
  const db = getSupabase().from('branches');
  const query = id ? db.update(values).eq('id', id).eq('clinic_id', clinicId) : db.insert({ ...values, clinic_id: clinicId });
  return unwrap<Branch>(await query.select('*').single());
}

export async function fetchStaff(clinicId: UUID): Promise<StaffMember[]> {
  const members = unwrap<Omit<StaffMember, 'profile'>[]>(
    await getSupabase().from('clinic_members').select('id, clinic_id, user_id, roles, status, created_at').eq('clinic_id', clinicId).order('created_at'),
  );
  if (members.length === 0) return [];
  const profiles = unwrap<(Pick<Profile, 'full_name' | 'phone' | 'qualification'> & { id: UUID })[]>(
    await getSupabase().from('profiles').select('id, full_name, phone, qualification').in('id', members.map((m) => m.user_id)),
  );
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return members.map((m) => ({ ...m, profile: byId.get(m.user_id) ?? null }));
}

export interface DoctorOption {
  user_id: UUID;
  full_name: string;
}

export async function fetchDoctors(clinicId: UUID): Promise<DoctorOption[]> {
  const staff = await fetchStaff(clinicId);
  return staff
    .filter((m) => m.status === 'active' && m.roles.includes('doctor'))
    .map((m) => ({ user_id: m.user_id, full_name: m.profile?.full_name || 'Doctor' }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function updateMember(memberId: UUID, values: { roles?: AppRole[]; status?: 'active' | 'suspended' }): Promise<void> {
  unwrap(await getSupabase().from('clinic_members').update(values).eq('id', memberId).select('id').single());
}

export async function inviteMember(input: { clinicId: UUID; email: string; fullName: string; roles: AppRole[]; branchIds?: UUID[] }): Promise<void> {
  const { error } = await getSupabase().functions.invoke('invite-member', { body: input });
  if (error) {
    // FunctionsHttpError carries the JSON body in `context`; surface our safe message only.
    const ctx = (error as { context?: Response }).context;
    const body = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null) : null;
    throw { message: body?.error ?? 'Could not send the invitation', code: ctx?.status === 403 ? '42501' : ctx?.status === 422 ? 'P0001' : undefined };
  }
}

export async function fetchProfile(userId: UUID): Promise<Profile> {
  return unwrap<Profile>(
    await getSupabase().from('profiles').select('id, full_name, phone, preferred_locale, qualification, medical_registration_no').eq('id', userId).single(),
  );
}

export async function updateProfile(userId: UUID, values: Partial<Omit<Profile, 'id'>>): Promise<Profile> {
  return unwrap<Profile>(
    await getSupabase()
      .from('profiles')
      .update(values)
      .eq('id', userId)
      .select('id, full_name, phone, preferred_locale, qualification, medical_registration_no')
      .single(),
  );
}

/** Names for a set of user ids (staff who share a clinic with the caller). */
export async function fetchProfileNames(ids: UUID[]): Promise<Map<UUID, string>> {
  if (ids.length === 0) return new Map();
  const rows = unwrap<{ id: UUID; full_name: string }[]>(await getSupabase().from('profiles').select('id, full_name').in('id', [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.full_name]));
}
