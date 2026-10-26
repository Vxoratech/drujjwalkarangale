-- =============================================================================
-- Vaidyora — 0013 Reports in the clinic's time zone; refunds and follow-ups
-- =============================================================================
-- Reporting rules
--   * Voided invoices are excluded from invoiced totals.
--   * Collections are payments minus refunds on the day the money moved.
--   * Inactive/deceased patients are excluded from "active patients" but their
--     historical visits and invoices still count in date-ranged reports.
-- =============================================================================

create or replace function public.dashboard_summary(p_clinic uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select private.clinic_tz(p_clinic) as tz,
           private.clinic_today(p_clinic) as today,
           date_trunc('month', private.clinic_today(p_clinic))::date as month_start
  )
  select jsonb_build_object(
    'appointments_today', (
      select count(*) from public.appointments a, b
      where a.clinic_id = p_clinic and (a.starts_at at time zone b.tz)::date = b.today
        and a.status not in ('cancelled', 'no_show')),
    'appointments_remaining_today', (
      select count(*) from public.appointments a, b
      where a.clinic_id = p_clinic and (a.starts_at at time zone b.tz)::date = b.today
        and a.status in ('scheduled', 'checked_in', 'in_consultation')),
    'patients_total', (
      select count(*) from public.patients p where p.clinic_id = p_clinic and p.status = 'active'),
    'patients_new_this_month', (
      select count(*) from public.patients p, b where p.clinic_id = p_clinic and p.registered_on >= b.month_start),
    'collected_this_month_paise', (
      (select coalesce(sum(pm.amount_paise), 0) from public.payments pm, b
        where pm.clinic_id = p_clinic and (pm.paid_at at time zone b.tz)::date >= b.month_start)
      - (select coalesce(sum(r.amount_paise), 0) from public.refunds r, b
        where r.clinic_id = p_clinic and (r.refunded_at at time zone b.tz)::date >= b.month_start)),
    'outstanding_paise', (
      select coalesce(sum(i.total_paise - i.amount_paid_paise), 0) from public.invoices i
      where i.clinic_id = p_clinic and i.status in ('issued', 'partially_paid')),
    'draft_consultations', (
      select count(*) from public.consultations c
      where c.clinic_id = p_clinic and c.doctor_id = auth.uid() and c.status = 'draft'),
    'follow_ups_next_7_days', (
      select count(*) from public.follow_ups f, b
      where f.clinic_id = p_clinic and f.status = 'pending' and f.due_date <= b.today + 7),
    'pending_investigations', (
      select count(*) from public.investigations iv
      where iv.clinic_id = p_clinic and iv.status in ('ordered', 'sample_collected'))
  );
$$;

drop function public.revenue_report(uuid, date, date);
create function public.revenue_report(p_clinic uuid, p_from date, p_to date)
returns table (day date, invoiced_paise bigint, collected_paise bigint, refunded_paise bigint, invoice_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text := private.clinic_tz(p_clinic);
begin
  if not private.has_permission(p_clinic, 'reports.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a date range of up to one year' using errcode = '22023';
  end if;
  return query
  select d::date,
         coalesce((select sum(i.total_paise) from public.invoices i
                   where i.clinic_id = p_clinic and i.status <> 'void' and i.issue_date = d::date), 0)::bigint,
         coalesce((select sum(pm.amount_paise) from public.payments pm
                   where pm.clinic_id = p_clinic and (pm.paid_at at time zone v_tz)::date = d::date), 0)::bigint,
         coalesce((select sum(r.amount_paise) from public.refunds r
                   where r.clinic_id = p_clinic and (r.refunded_at at time zone v_tz)::date = d::date), 0)::bigint,
         (select count(*) from public.invoices i
          where i.clinic_id = p_clinic and i.status <> 'void' and i.issue_date = d::date)
  from generate_series(p_from, p_to, interval '1 day') d
  order by 1;
end;
$$;

create or replace function public.payment_method_report(p_clinic uuid, p_from date, p_to date)
returns table (method public.payment_method, total_paise bigint, payment_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text := private.clinic_tz(p_clinic);
begin
  if not private.has_permission(p_clinic, 'reports.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select pm.method, sum(pm.amount_paise)::bigint, count(*)
  from public.payments pm
  where pm.clinic_id = p_clinic and (pm.paid_at at time zone v_tz)::date between p_from and p_to
  group by pm.method
  order by 2 desc;
end;
$$;

create or replace function public.appointment_status_report(p_clinic uuid, p_from date, p_to date)
returns table (status public.appointment_status, appointment_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text := private.clinic_tz(p_clinic);
begin
  if not private.has_permission(p_clinic, 'reports.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select a.status, count(*)
  from public.appointments a
  where a.clinic_id = p_clinic and (a.starts_at at time zone v_tz)::date between p_from and p_to
  group by a.status
  order by 2 desc;
end;
$$;

revoke execute on function public.revenue_report(uuid, date, date) from public, anon;
grant execute on function public.revenue_report(uuid, date, date) to authenticated;
