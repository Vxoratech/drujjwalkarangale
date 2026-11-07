// Staff and administrator account operations that need the Auth admin API
// (service-role key), so they cannot run in the browser:
//   invite          send (or resend) a staff invitation and link the account
//   reset_password  email a password-reset link to a staff member
//   set_status      activate or deactivate staff access and block sign-in
//   invite_admin    appoint an administrator (primary doctor only)
//   set_admin_status activate or deactivate an administrator (primary doctor only)
// Every action first checks the caller's authority with their own JWT; the
// database repeats the check inside each function it calls.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { z } from 'npm:zod@3.24.1';
import { corsHeaders } from '../_shared/cors.ts';
import { env, json, readJsonBody, withinRateLimit } from '../_shared/http.ts';

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), staffId: z.string().uuid() }),
  z.object({ action: z.literal('reset_password'), staffId: z.string().uuid() }),
  z.object({ action: z.literal('set_status'), staffId: z.string().uuid(), status: z.enum(['active', 'inactive']), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('invite_admin'), email: z.string().trim().toLowerCase().email().max(254), fullName: z.string().trim().min(2).max(120) }),
  z.object({ action: z.literal('set_admin_status'), userId: z.string().uuid(), active: z.boolean() }),
]);

// Long enough to be permanent; lifted on reactivation.
const BAN_FOREVER = '876000h';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401, origin);
  const parsed = BodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return json({ error: 'Invalid request' }, 400, origin);
  const body = parsed.data;

  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const siteUrl = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: caller } = await asCaller.auth.getUser();
  if (!caller.user) return json({ error: 'Unauthorized' }, 401, origin);
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  // Each of these can send an email: 20 per caller per hour.
  if (!(await withinRateLimit(admin, `staff_admin:${caller.user.id}`, 20, 3600))) {
    return json({ error: 'Too many requests. Please try again later.' }, 429, origin);
  }

  const { data: access } = await asCaller.rpc('my_access');
  const accountType = (access as { account_type?: string } | null)?.account_type ?? null;

  if (body.action === 'invite_admin' || body.action === 'set_admin_status') {
    if (accountType !== 'primary_doctor') return json({ error: 'Only the primary doctor can manage administrators' }, 403, origin);

    if (body.action === 'set_admin_status') {
      const { error } = await asCaller.rpc('set_admin_active', { p_user: body.userId, p_active: body.active });
      if (error) return json({ error: error.code === '42501' ? 'Not permitted' : 'Administrator not found' }, error.code === '42501' ? 403 : 404, origin);
      await admin.auth.admin.updateUserById(body.userId, { ban_duration: body.active ? 'none' : BAN_FOREVER });
      return json({ ok: true }, 200, origin);
    }

    const userId = await inviteOrFind(admin, body.email, body.fullName, siteUrl);
    if (!userId) return json({ error: 'Could not invite this person' }, 422, origin);
    const { error } = await admin.rpc('link_admin_account', { p_user: userId });
    if (error) return json({ error: 'This email belongs to a staff member or the doctor' }, 409, origin);
    return json({ userId }, 200, origin);
  }

  // Staff actions: the caller must be allowed to manage this staff member.
  const { data: allowed } = await asCaller.rpc('can_manage_staff_member', { p_staff: body.staffId });
  if (allowed !== true) return json({ error: 'Not permitted' }, 403, origin);
  const { data: staff } = await admin.from('staff_members').select('id, email, full_name, user_id, status').eq('id', body.staffId).single();
  if (!staff) return json({ error: 'The record could not be found' }, 404, origin);

  if (body.action === 'invite') {
    if (staff.status !== 'invited') return json({ error: 'This staff member has already joined' }, 409, origin);
    const userId = staff.user_id ?? (await inviteOrFind(admin, staff.email, staff.full_name, siteUrl));
    if (!userId) return json({ error: 'Could not invite this person' }, 422, origin);
    if (staff.user_id) {
      // Resend: a fresh invitation email for an unconfirmed account.
      await admin.auth.admin.inviteUserByEmail(staff.email, { redirectTo: `${siteUrl}/auth/set-password` });
    }
    const { error } = await admin.rpc('link_staff_account', { p_staff: staff.id, p_user: userId });
    if (error) {
      console.error('staff-admin: link failed', error.code);
      return json({ error: 'This email already belongs to another account' }, 409, origin);
    }
    return json({ userId }, 200, origin);
  }

  if (body.action === 'reset_password') {
    if (staff.status !== 'active') return json({ error: 'Only active staff can reset their password' }, 409, origin);
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error } = await anon.auth.resetPasswordForEmail(staff.email, { redirectTo: `${siteUrl}/auth/set-password` });
    if (error) return json({ error: 'Could not send the reset email' }, 502, origin);
    return json({ ok: true }, 200, origin);
  }

  // set_status: the database records the change (with reason) and removes
  // access immediately; banning the auth user also stops token refresh.
  const { error } = await asCaller.rpc('set_staff_status', { p_staff: staff.id, p_status: body.status, p_reason: body.reason ?? null });
  if (error) {
    const safe = error.code === '23514' ? error.message : 'Could not change access';
    return json({ error: safe }, error.code === '23514' ? 422 : 403, origin);
  }
  if (staff.user_id) {
    await admin.auth.admin.updateUserById(staff.user_id, { ban_duration: body.status === 'inactive' ? BAN_FOREVER : 'none' });
  }
  return json({ ok: true }, 200, origin);
});

// deno-lint-ignore no-explicit-any
async function inviteOrFind(admin: any, email: string, fullName: string, siteUrl: string): Promise<string | undefined> {
  const invite = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo: `${siteUrl}/auth/set-password` });
  if (invite.data?.user) return invite.data.user.id as string;
  const { data: existing } = await admin.rpc('find_user_id_by_email', { p_email: email });
  return (existing as string | null) ?? undefined;
}
