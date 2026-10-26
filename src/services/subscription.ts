import { getSupabase } from '@/lib/supabase/client';
import type { TenantSubscription, UUID } from '@/types/domain';
import { unwrap } from './_helpers';

/**
 * Subscription state is written only by platform RPCs. A payment provider
 * (Razorpay/Stripe) would be integrated behind a server-side webhook that
 * calls those RPCs; the browser never changes plans directly.
 */
export async function fetchSubscription(clinicId: UUID): Promise<TenantSubscription | null> {
  return unwrap<TenantSubscription | null>(
    await getSupabase()
      .from('tenant_subscriptions')
      .select('id, clinic_id, status, billing_interval, trial_ends_at, current_period_end, provider, plan:subscription_plans(id, code, name, price_paise, billing_interval, limits)')
      .eq('clinic_id', clinicId)
      .maybeSingle(),
  );
}
