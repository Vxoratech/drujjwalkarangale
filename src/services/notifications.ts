import { getSupabase } from '@/lib/supabase/client';
import type { AppNotification, UUID } from '@/types/domain';
import { unwrap } from './_helpers';

/** The signed-in user's notifications (RLS: own rows only). Created server-side by triggers. */
export async function listNotifications(): Promise<AppNotification[]> {
  return unwrap<AppNotification[]>(
    await getSupabase().from('notifications').select('id, kind, title, link, read_at, created_at').order('created_at', { ascending: false }).limit(20),
  );
}

export async function markNotificationsRead(ids: UUID[]): Promise<void> {
  if (ids.length === 0) return;
  unwrap(await getSupabase().from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).select('id'));
}
