import { getSupabase } from '@/lib/supabase/client';
import type { AppointmentStatus, BranchMetric, ClinicalReport, DateString, DoctorOverview, OrgOverview, Paise, PaymentMethod, RecentPatient, RevenueRow, TrendRow, UUID } from '@/types/domain';
import { unwrap } from './_helpers';

const num = <T extends object>(row: T): T =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v])) as T;

/** `branchId` null = all of the caller's branches (server-side scope). */
export async function fetchRevenueReport(branchId: UUID | null, from: DateString, to: DateString): Promise<RevenueRow[]> {
  return unwrap<RevenueRow[]>(await getSupabase().rpc('revenue_report', { p_branch: branchId, p_from: from, p_to: to })).map(num);
}

export async function fetchPaymentMethodReport(branchId: UUID | null, from: DateString, to: DateString): Promise<{ method: PaymentMethod; total_paise: Paise; payment_count: number }[]> {
  return unwrap<{ method: PaymentMethod; total_paise: Paise; payment_count: number }[]>(
    await getSupabase().rpc('payment_method_report', { p_branch: branchId, p_from: from, p_to: to }),
  ).map(num);
}

export async function fetchAppointmentStatusReport(branchId: UUID | null, from: DateString, to: DateString): Promise<{ status: AppointmentStatus; appointment_count: number }[]> {
  return unwrap<{ status: AppointmentStatus; appointment_count: number }[]>(
    await getSupabase().rpc('appointment_status_report', { p_branch: branchId, p_from: from, p_to: to }),
  ).map(num);
}

/** Aggregate counts and sums only (no record contents). Sections the caller cannot see are absent. */
export async function fetchOverview(branchId: UUID | null, from: DateString, to: DateString): Promise<OrgOverview> {
  return num(unwrap<OrgOverview>(await getSupabase().rpc('org_overview', { p_branch: branchId, p_from: from, p_to: to })));
}

export async function fetchClinicTrends(branchId: UUID | null, from: DateString, to: DateString, bucket: 'day' | 'week' | 'month'): Promise<TrendRow[]> {
  return unwrap<TrendRow[]>(await getSupabase().rpc('clinic_trends', { p_branch: branchId, p_from: from, p_to: to, p_bucket: bucket })).map(num);
}

export async function fetchBranchMetrics(from: DateString, to: DateString): Promise<BranchMetric[]> {
  return unwrap<BranchMetric[]>(await getSupabase().rpc('branch_metrics', { p_from: from, p_to: to })).map(num);
}

export async function fetchClinicalReport(branchId: UUID | null, from: DateString, to: DateString): Promise<ClinicalReport> {
  return num(unwrap<ClinicalReport>(await getSupabase().rpc('clinical_report', { p_branch: branchId, p_from: from, p_to: to })));
}

export async function fetchDoctorOverview(): Promise<DoctorOverview> {
  return num(unwrap<DoctorOverview>(await getSupabase().rpc('doctor_overview')));
}

/** Patients the current user opened recently (their own view events only). */
export async function fetchRecentPatients(): Promise<RecentPatient[]> {
  return unwrap<RecentPatient[]>(await getSupabase().rpc('my_recent_patients', { p_limit: 8 }));
}
