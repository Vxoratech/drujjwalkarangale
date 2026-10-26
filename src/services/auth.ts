import { getSupabase } from '@/lib/supabase/client';

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string, fullName: string): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

let userInitiatedSignOut = false;
const EXPIRED_FLAG = 'vaidyora.sessionExpired';

export async function signOut(): Promise<void> {
  userInitiatedSignOut = true;
  await getSupabase().auth.signOut();
}

/** Called when the backend rejects the session; the sign-in page then explains why. */
export async function expireSession(): Promise<void> {
  try {
    sessionStorage.setItem(EXPIRED_FLAG, '1');
  } catch {
    /* storage unavailable */
  }
  await getSupabase().auth.signOut({ scope: 'local' });
}

/** True once after an involuntary sign-out (expired or revoked session). */
export function consumeSessionExpired(): boolean {
  try {
    const flagged = sessionStorage.getItem(EXPIRED_FLAG) === '1';
    sessionStorage.removeItem(EXPIRED_FLAG);
    return flagged;
  } catch {
    return false;
  }
}

/** Distinguishes user sign-outs from token-refresh failures (see AuthProvider). */
export function takeUserInitiatedSignOut(): boolean {
  const value = userInitiatedSignOut;
  userInitiatedSignOut = false;
  return value;
}

export function markSessionExpired(): void {
  try {
    sessionStorage.setItem(EXPIRED_FLAG, '1');
  } catch {
    /* storage unavailable */
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/set-password`,
  });
  // Do not reveal whether the account exists.
  if (error && error.status !== 400) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) throw error;
}
