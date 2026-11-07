/**
 * One-time trusted setup: binds Dr. Ujjwal Karangale as the primary doctor and,
 * optionally, appoints the first administrator. Both receive an invitation
 * email and choose their own password; this script never handles passwords.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SITE_URL=https://app.example.in \
 *   DOCTOR_EMAIL=... [DOCTOR_NAME='Dr. Ujjwal Karangale'] \
 *   [ADMIN_EMAIL=... ADMIN_NAME=...] npm run bootstrap
 *
 * The service-role key is read from the shell environment only — never put it
 * in a VITE_* variable or commit it. Running it again is safe: the doctor can
 * be bound only once, and the database refuses any attempt to change it.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl = process.env.SITE_URL ?? 'http://localhost:5173';
const doctorEmail = process.env.DOCTOR_EMAIL?.trim().toLowerCase();
const doctorName = process.env.DOCTOR_NAME ?? 'Dr. Ujjwal Karangale';
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminName = process.env.ADMIN_NAME ?? 'Clinic Administrator';

if (!url || !serviceKey || !doctorEmail) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DOCTOR_EMAIL (optionally ADMIN_EMAIL, ADMIN_NAME, SITE_URL).');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Invites the person (an email lets them set a password) or finds their existing account. */
export async function inviteOrFind(client: SupabaseClient, email: string, fullName: string): Promise<string> {
  const invite = await client.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo: `${siteUrl}/auth/set-password` });
  if (invite.data.user) return invite.data.user.id;
  const { data } = await client.rpc('find_user_id_by_email', { p_email: email });
  if (!data) throw new Error(`Could not invite ${email}: ${invite.error?.message ?? 'unknown error'}`);
  return data as string;
}

async function main(): Promise<void> {
  const { data: org } = await admin.from('organization').select('primary_doctor_id').single();
  if (org?.primary_doctor_id) {
    console.log('The primary doctor is already set; skipping.');
  } else {
    await inviteOrFind(admin, doctorEmail!, doctorName);
    const { error } = await admin.rpc('bootstrap_primary_doctor', { p_email: doctorEmail });
    if (error) throw new Error(`bind primary doctor: ${error.message}`);
    console.log(`Primary doctor bound: ${doctorEmail} (invitation email sent).`);
  }

  if (adminEmail) {
    const id = await inviteOrFind(admin, adminEmail, adminName);
    const { error } = await admin.rpc('link_admin_account', { p_user: id });
    if (error) throw new Error(`appoint administrator: ${error.message}`);
    console.log(`Administrator appointed: ${adminEmail} (invitation email sent).`);
  }
}

main().catch((error: unknown) => {
  console.error('Bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
