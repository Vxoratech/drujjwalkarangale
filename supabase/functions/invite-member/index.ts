// Invite a staff member to a clinic.
// Trusted server-side operation: needs the service-role key to call the Auth
// admin API, so it cannot run in the browser. The caller's own JWT is used to
// verify they hold `users.manage` in the target clinic before anything happens.
import { createClient } from 'npm:@supabase/supabase-js@2.47.10';
import { z } from 'npm:zod@3.24.1';
import { corsHeaders } from '../_shared/cors.ts';
import { json } from '../_shared/http.ts';

const InviteSchema = z.object({
  clinicId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  roles: z.array(z.enum(['admin', 'doctor'])).min(1).max(2),
  branchIds: z.array(z.string().uuid()).max(50).default([]),
});


Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const siteUrl = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';
  if (!url || !anonKey || !serviceKey) return json({ error: 'Server misconfigured' }, 500, origin);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401, origin);

  const parsed = InviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Invalid request', issues: parsed.error.flatten().fieldErrors }, 400, origin);
  const { clinicId, email, fullName, roles, branchIds } = parsed.data;

  // 1. Authorise as the caller (RLS-scoped client).
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: caller } = await asCaller.auth.getUser();
  if (!caller.user) return json({ error: 'Unauthorized' }, 401, origin);
  const { data: perms, error: permError } = await asCaller.rpc('my_permissions', { p_clinic: clinicId });
  if (permError || !(perms as string[] | null)?.includes('users.manage')) {
    return json({ error: 'You do not have permission to invite staff' }, 403, origin);
  }

  // 2. Privileged work with the service role.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let userId: string | undefined;
  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${siteUrl}/auth/set-password`,
  });
  if (invite.data.user) {
    userId = invite.data.user.id;
  } else {
    // Already registered → look the user up and just add the membership.
    const { data: existing } = await admin.rpc('find_user_id_by_email', { p_email: email });
    userId = (existing as string | null) ?? undefined;
  }
  if (!userId) return json({ error: 'Could not invite this user' }, 422, origin);

  // The membership stays 'invited' until the user signs in and accepts it
  // (public.accept_invitation). An existing active membership is not downgraded.
  const { data: existingMember } = await admin.from('clinic_members').select('id, status').eq('clinic_id', clinicId).eq('user_id', userId).maybeSingle();
  if (existingMember?.status === 'active') return json({ error: 'This person is already a member of the clinic' }, 409, origin);

  const { data: member, error: memberError } = await admin
    .from('clinic_members')
    .upsert({ clinic_id: clinicId, user_id: userId, roles, status: 'invited', invited_by: caller.user.id }, { onConflict: 'clinic_id,user_id' })
    .select('id')
    .single();
  if (memberError || !member) {
    // Plan limits raise P0001 with a safe message.
    const safe = memberError?.code === 'P0001' ? memberError.message : 'Could not add the member to this clinic';
    console.error('invite-member: membership upsert failed', memberError?.code);
    return json({ error: safe }, memberError?.code === 'P0001' ? 422 : 500, origin);
  }
  if (branchIds.length > 0) {
    await admin.from('member_branches').delete().eq('member_id', member.id);
    const { error: branchError } = await admin
      .from('member_branches')
      .insert(branchIds.map((branch_id) => ({ member_id: member.id, clinic_id: clinicId, branch_id })));
    if (branchError) return json({ error: 'Could not set branch access' }, 422, origin);
  }

  return json({ userId, invited: Boolean(invite.data.user) }, 200, origin);
});
