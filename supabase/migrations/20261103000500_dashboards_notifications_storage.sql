-- =============================================================================
-- Vaidyora — 0500 Dashboards, reports, notifications, storage and retention
-- =============================================================================
-- Every aggregate is limited to the caller's branches and an optional branch
-- filter. Sections the caller has no permission for come back as null, so
-- one function feeds the Admin, Branch Manager and front-desk dashboards.
-- =============================================================================

-- Resolves the branch filter: null means all of the caller's branches; a
-- named branch must be one of them.
create or replace function private.report_branches(p_branch uuid)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if p_branch is not null then
    if not private.in_branch(p_branch) then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    return next p_branch;
    return;
  end if;
  return query select private.my_branch_ids();
end;
$$;

create or replace function private.check_range(p_from date, p_to date)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a date range of up to one year' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Overview (Admin and staff dashboards)
-- -----------------------------------------------------------------------------
create or replace function public.org_overview(p_branch uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_today date := private.org_today();
  v_from date := coalesce(p_from, date_trunc('month', private.org_today())::date);
  v_to date := coalesce(p_to, private.org_today());
  v_branches uuid[];
  v_ops boolean := private.can('reports.operational');
  v_fin boolean := private.can('reports.financial');
  v_out jsonb := '{}'::jsonb;
begin
  if not (v_ops or v_fin or private.can('reports.clinical')) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.check_range(v_from, v_to);
  select coalesce(array_agg(b), '{}') into v_branches from private.report_branches(p_branch) b;

  if v_ops then
    v_out := v_out || jsonb_build_object(
      'patients_total', case when p_branch is null and private.has_all_branches()
          then (select count(*) from public.patients p where p.status = 'active')
          else (select count(*) from public.patients p where p.status = 'active' and p.registered_branch_id = any (v_branches)) end,
      'patients_new', (select count(*) from public.patients p where p.registered_on between v_from and v_to and p.registered_branch_id = any (v_branches)),
      'branches_active', (select count(*) from public.clinic_branches b where b.is_active and b.id = any (v_branches)),
      'appointments_today', (select count(*) from public.appointments a where a.branch_id = any (v_branches)
          and (a.starts_at at time zone v_tz)::date = v_today and a.status not in ('cancelled', 'no_show')),
      'appointments_remaining_today', (select count(*) from public.appointments a where a.branch_id = any (v_branches)
          and (a.starts_at at time zone v_tz)::date = v_today and a.status in ('scheduled', 'checked_in', 'in_consultation')),
      'appointments_in_range', (select count(*) from public.appointments a where a.branch_id = any (v_branches)
          and (a.starts_at at time zone v_tz)::date between v_from and v_to),
      'appointments_no_show', (select count(*) from public.appointments a where a.branch_id = any (v_branches) and a.status = 'no_show'
          and (a.starts_at at time zone v_tz)::date between v_from and v_to),
      'consultations_completed', (select count(*) from public.consultations c where c.branch_id = any (v_branches) and c.status = 'finalized'
          and c.visit_date between v_from and v_to),
      'consultations_open', (select count(*) from public.consultations c where c.branch_id = any (v_branches) and c.status = 'draft'),
      'follow_ups_pending', (select count(*) from public.follow_ups f where f.branch_id = any (v_branches) and f.status = 'pending'),
      'follow_ups_overdue', (select count(*) from public.follow_ups f where f.branch_id = any (v_branches) and f.status = 'pending' and f.due_date < v_today));
  end if;

  if v_fin then
    v_out := v_out || jsonb_build_object(
      'collected_paise', (select coalesce(sum(pm.amount_paise), 0) from public.payments pm join public.invoices i on i.id = pm.invoice_id
          where i.branch_id = any (v_branches) and (pm.paid_at at time zone v_tz)::date between v_from and v_to),
      'refunded_paise', (select coalesce(sum(r.amount_paise), 0) from public.refunds r join public.invoices i on i.id = r.invoice_id
          where i.branch_id = any (v_branches) and (r.refunded_at at time zone v_tz)::date between v_from and v_to),
      'outstanding_paise', (select coalesce(sum(i.total_paise - i.amount_paid_paise), 0) from public.invoices i
          where i.branch_id = any (v_branches) and i.status in ('issued', 'partially_paid')),
      'outstanding_invoices', (select count(*) from public.invoices i where i.branch_id = any (v_branches) and i.status in ('issued', 'partially_paid')),
      'unreconciled_payments', (select count(*) from public.payments pm join public.invoices i on i.id = pm.invoice_id
          where i.branch_id = any (v_branches) and pm.reconciled_at is null));
  end if;
  return v_out;
end;
$$;

create or replace function public.branch_metrics(p_from date, p_to date)
returns table (branch_id uuid, branch_name text, is_active boolean, patients_registered bigint, appointments bigint,
  appointments_completed bigint, no_shows bigint, consultations_completed bigint,
  invoiced_paise bigint, collected_paise bigint, outstanding_paise bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_fin boolean := private.can('reports.financial');
begin
  if not (private.can('reports.operational') or v_fin) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.check_range(p_from, p_to);
  return query
  select b.id, b.name, b.is_active,
    (select count(*) from public.patients p where p.registered_branch_id = b.id and p.registered_on between p_from and p_to),
    (select count(*) from public.appointments a where a.branch_id = b.id and (a.starts_at at time zone v_tz)::date between p_from and p_to),
    (select count(*) from public.appointments a where a.branch_id = b.id and a.status = 'completed' and (a.starts_at at time zone v_tz)::date between p_from and p_to),
    (select count(*) from public.appointments a where a.branch_id = b.id and a.status = 'no_show' and (a.starts_at at time zone v_tz)::date between p_from and p_to),
    (select count(*) from public.consultations c where c.branch_id = b.id and c.status = 'finalized' and c.visit_date between p_from and p_to),
    case when v_fin then (select coalesce(sum(i.total_paise), 0) from public.invoices i where i.branch_id = b.id and i.status <> 'void' and i.issue_date between p_from and p_to)::bigint end,
    case when v_fin then (select coalesce(sum(pm.amount_paise), 0) from public.payments pm join public.invoices i on i.id = pm.invoice_id
       where i.branch_id = b.id and (pm.paid_at at time zone v_tz)::date between p_from and p_to)::bigint end,
    case when v_fin then (select coalesce(sum(i.total_paise - i.amount_paid_paise), 0) from public.invoices i where i.branch_id = b.id and i.status in ('issued', 'partially_paid'))::bigint end
  from public.clinic_branches b
  where b.id in (select private.my_branch_ids())
  order by b.is_primary desc, b.name;
end;
$$;

create or replace function public.clinic_trends(p_branch uuid, p_from date, p_to date, p_bucket text default 'day')
returns table (period date, new_patients bigint, appointments bigint, appointments_completed bigint, consultations_completed bigint, collected_paise bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_fin boolean := private.can('reports.financial');
  v_branches uuid[];
begin
  if not (private.can('reports.operational') or v_fin) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'Unknown period' using errcode = '22023';
  end if;
  perform private.check_range(p_from, p_to);
  select coalesce(array_agg(b), '{}') into v_branches from private.report_branches(p_branch) b;
  return query
  with periods as (
    select distinct date_trunc(p_bucket, d)::date as period from generate_series(p_from, p_to, interval '1 day') d
  )
  select pr.period,
    (select count(*) from public.patients p where p.registered_branch_id = any (v_branches)
       and p.registered_on between p_from and p_to and date_trunc(p_bucket, p.registered_on)::date = pr.period),
    (select count(*) from public.appointments a where a.branch_id = any (v_branches)
       and (a.starts_at at time zone v_tz)::date between p_from and p_to
       and date_trunc(p_bucket, (a.starts_at at time zone v_tz)::date)::date = pr.period),
    (select count(*) from public.appointments a where a.branch_id = any (v_branches) and a.status = 'completed'
       and (a.starts_at at time zone v_tz)::date between p_from and p_to
       and date_trunc(p_bucket, (a.starts_at at time zone v_tz)::date)::date = pr.period),
    (select count(*) from public.consultations c where c.branch_id = any (v_branches) and c.status = 'finalized'
       and c.visit_date between p_from and p_to and date_trunc(p_bucket, c.visit_date)::date = pr.period),
    case when v_fin then (select coalesce(sum(pm.amount_paise), 0) from public.payments pm join public.invoices i on i.id = pm.invoice_id
       where i.branch_id = any (v_branches) and (pm.paid_at at time zone v_tz)::date between p_from and p_to
         and date_trunc(p_bucket, (pm.paid_at at time zone v_tz)::date)::date = pr.period)::bigint end
  from periods pr
  order by 1;
end;
$$;

create or replace function public.revenue_report(p_branch uuid, p_from date, p_to date)
returns table (day date, invoiced_paise bigint, collected_paise bigint, refunded_paise bigint, invoice_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_branches uuid[];
begin
  if not private.can('reports.financial') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.check_range(p_from, p_to);
  select coalesce(array_agg(b), '{}') into v_branches from private.report_branches(p_branch) b;
  return query
  select d::date,
    coalesce((select sum(i.total_paise) from public.invoices i where i.branch_id = any (v_branches) and i.status <> 'void' and i.issue_date = d::date), 0)::bigint,
    coalesce((select sum(pm.amount_paise) from public.payments pm join public.invoices i on i.id = pm.invoice_id
              where i.branch_id = any (v_branches) and (pm.paid_at at time zone v_tz)::date = d::date), 0)::bigint,
    coalesce((select sum(r.amount_paise) from public.refunds r join public.invoices i on i.id = r.invoice_id
              where i.branch_id = any (v_branches) and (r.refunded_at at time zone v_tz)::date = d::date), 0)::bigint,
    (select count(*) from public.invoices i where i.branch_id = any (v_branches) and i.status <> 'void' and i.issue_date = d::date)
  from generate_series(p_from, p_to, interval '1 day') d
  order by 1;
end;
$$;

create or replace function public.payment_method_report(p_branch uuid, p_from date, p_to date)
returns table (method public.payment_method, total_paise bigint, payment_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_branches uuid[];
begin
  if not private.can('reports.financial') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.check_range(p_from, p_to);
  select coalesce(array_agg(b), '{}') into v_branches from private.report_branches(p_branch) b;
  return query
  select pm.method, sum(pm.amount_paise)::bigint, count(*)
  from public.payments pm join public.invoices i on i.id = pm.invoice_id
  where i.branch_id = any (v_branches) and (pm.paid_at at time zone v_tz)::date between p_from and p_to
  group by pm.method
  order by 2 desc;
end;
$$;

create or replace function public.appointment_status_report(p_branch uuid, p_from date, p_to date)
returns table (status public.appointment_status, appointment_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_branches uuid[];
begin
  if not private.can('reports.operational') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.check_range(p_from, p_to);
  select coalesce(array_agg(b), '{}') into v_branches from private.report_branches(p_branch) b;
  return query
  select a.status, count(*)
  from public.appointments a
  where a.branch_id = any (v_branches) and (a.starts_at at time zone v_tz)::date between p_from and p_to
  group by a.status
  order by 2 desc;
end;
$$;

-- Clinical activity counts (no clinical content).
create or replace function public.clinical_report(p_branch uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_branches uuid[];
begin
  if not private.can('reports.clinical') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.check_range(p_from, p_to);
  select coalesce(array_agg(b), '{}') into v_branches from private.report_branches(p_branch) b;
  return jsonb_build_object(
    'consultations_finalized', (select count(*) from public.consultations c where c.branch_id = any (v_branches)
        and c.status = 'finalized' and c.visit_date between p_from and p_to),
    'new_patients_seen', (select count(distinct c.patient_id) from public.consultations c where c.branch_id = any (v_branches)
        and c.visit_date between p_from and p_to
        and not exists (select 1 from public.consultations e where e.patient_id = c.patient_id and e.visit_date < p_from)),
    'prescriptions_issued', (select count(*) from public.prescriptions r where r.branch_id = any (v_branches)
        and r.status = 'issued' and (r.issued_at at time zone v_tz)::date between p_from and p_to),
    'prescriptions_revised', (select count(*) from public.prescription_revisions v join public.prescriptions r on r.id = v.prescription_id
        where r.branch_id = any (v_branches) and v.revision_number > 1 and (v.issued_at at time zone v_tz)::date between p_from and p_to),
    'investigations_ordered', (select count(*) from public.investigations i where i.branch_id = any (v_branches)
        and (i.ordered_at at time zone v_tz)::date between p_from and p_to),
    'investigations_resulted', (select count(*) from public.investigations i where i.branch_id = any (v_branches)
        and (i.resulted_at at time zone v_tz)::date between p_from and p_to),
    'follow_ups_created', (select count(*) from public.follow_ups f where f.branch_id = any (v_branches)
        and (f.created_at at time zone v_tz)::date between p_from and p_to),
    'by_branch', coalesce((select jsonb_agg(jsonb_build_object('branch_id', b.id, 'branch_name', b.name,
        'consultations', (select count(*) from public.consultations c where c.branch_id = b.id and c.status = 'finalized' and c.visit_date between p_from and p_to))
        order by b.is_primary desc, b.name)
      from public.clinic_branches b where b.id = any (v_branches)), '[]'));
end;
$$;

-- Admin dashboard: what staff have been doing (event counts, not content).
create or replace function public.staff_activity(p_from date, p_to date)
returns table (staff_id uuid, full_name text, designation public.staff_designation, status public.staff_status,
  event_count bigint, last_activity_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
begin
  if not private.can('staff.view') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.check_range(p_from, p_to);
  return query
  select s.id, s.full_name, s.designation, s.status,
    (select count(*) from public.audit_events e where e.actor_id = s.user_id and (e.created_at at time zone v_tz)::date between p_from and p_to),
    (select max(e.created_at) from public.audit_events e where e.actor_id = s.user_id)
  from public.staff_members s
  where private.can_see_staff(s.id)
  order by 5 desc, s.full_name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Doctor dashboard (clinical tasks first)
-- -----------------------------------------------------------------------------
create or replace function public.doctor_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_today date := private.org_today();
begin
  if not private.is_doctor() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'appointments_today', (select count(*) from public.appointments a
        where (a.starts_at at time zone v_tz)::date = v_today and a.status not in ('cancelled', 'no_show')),
    'waiting', (select count(*) from public.appointments a where (a.starts_at at time zone v_tz)::date = v_today and a.status = 'checked_in'),
    'in_progress', (select count(*) from public.consultations c where c.status = 'draft'),
    'completed_today', (select count(*) from public.consultations c where c.status = 'finalized' and (c.finalized_at at time zone v_tz)::date = v_today),
    'completed_this_month', (select count(*) from public.consultations c where c.status = 'finalized' and c.visit_date >= date_trunc('month', v_today)::date),
    'follow_ups_due', (select count(*) from public.follow_ups f where f.status = 'pending' and f.due_date <= v_today + 7),
    'pending_prescriptions', (select count(*) from public.prescriptions r where r.status = 'draft'),
    'pending_results', (select count(*) from public.investigations i where i.status in ('ordered', 'sample_collected')),
    'next_patient', (
      select jsonb_build_object('appointment_id', a.id, 'patient_id', p.id, 'patient_code', p.patient_code,
        'first_name', p.first_name, 'last_name', p.last_name, 'starts_at', a.starts_at, 'status', a.status,
        'branch_id', b.id, 'branch_name', b.name, 'type', a.type, 'reason', a.reason)
      from public.appointments a join public.patients p on p.id = a.patient_id join public.clinic_branches b on b.id = a.branch_id
      where (a.starts_at at time zone v_tz)::date = v_today and a.status in ('checked_in', 'scheduled')
      order by (a.status = 'checked_in') desc, a.starts_at
      limit 1),
    'branch_schedule', coalesce((
      select jsonb_agg(jsonb_build_object('branch_id', b.id, 'branch_name', b.name,
        'appointments', (select count(*) from public.appointments a where a.branch_id = b.id
            and (a.starts_at at time zone v_tz)::date = v_today and a.status not in ('cancelled', 'no_show')),
        'remaining', (select count(*) from public.appointments a where a.branch_id = b.id
            and (a.starts_at at time zone v_tz)::date = v_today and a.status in ('scheduled', 'checked_in', 'in_consultation')),
        'first_at', (select min(a.starts_at) from public.appointments a where a.branch_id = b.id
            and (a.starts_at at time zone v_tz)::date = v_today and a.status not in ('cancelled', 'no_show')))
        order by b.is_primary desc, b.name)
      from public.clinic_branches b where b.is_active), '[]'));
end;
$$;

create or replace function public.my_recent_patients(p_limit integer default 8)
returns table (patient_id uuid, first_name text, last_name text, patient_code text, last_viewed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_user() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select p.id, p.first_name, p.last_name, p.patient_code, v.last_viewed_at
  from (
    select e.entity_id, max(e.created_at) as last_viewed_at
    from public.audit_events e
    where e.actor_id = auth.uid() and e.event_type = 'patients.viewed' and e.created_at > now() - interval '30 days'
    group by e.entity_id
  ) v
  join public.patients p on p.id = v.entity_id
  where private.can_see_patient(p.id)
  order by v.last_viewed_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications (to the primary doctor about the schedule and results)
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('appointment_booked', 'appointment_cancelled', 'investigation_resulted', 'staff_invited', 'system')),
  title text not null check (char_length(title) <= 160),
  link text check (link ~ '^/[A-Za-z0-9/_?=&-]*$'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create or replace function private.notify_doctor(p_kind text, p_title text, p_link text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_doctor uuid := (select primary_doctor_id from public.organization);
begin
  if v_doctor is not null and v_doctor is distinct from auth.uid() then
    insert into public.notifications (user_id, kind, title, link) values (v_doctor, p_kind, p_title, p_link);
  end if;
end;
$$;

create or replace function private.notify_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.notify_doctor('appointment_booked', 'New appointment booked', '/appointments/' || new.id);
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.notify_doctor('appointment_cancelled', 'An appointment was cancelled', '/appointments/' || new.id);
  end if;
  return new;
end;
$$;
create trigger appointments_notify after insert or update of status on public.appointments
  for each row execute function private.notify_appointment();

create or replace function private.notify_investigation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'resulted' and old.status <> 'resulted' then
    perform private.notify_doctor('investigation_resulted', 'An investigation result is ready', '/patients/' || new.patient_id);
  end if;
  return new;
end;
$$;
create trigger investigations_notify after update of status on public.investigations
  for each row execute function private.notify_investigation();

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: one private bucket. Patient files can be uploaded only against a
-- pending document row and are never read directly; the document-url Edge
-- Function issues short-lived signed links after an audited check.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-files', 'clinic-files', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create or replace function private.storage_can_upload(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if split_part(p_name, '/', 1) = 'branding' then
    return private.can('settings.organization');
  elsif split_part(p_name, '/', 1) = 'patients' then
    return exists (
      select 1 from public.patient_documents d
      where d.storage_path = p_name and d.uploaded_by = auth.uid() and d.uploaded_at is null and d.deleted_at is null
        and private.can_at('investigations.upload', d.branch_id));
  end if;
  return false;
end;
$$;

create policy clinic_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinic-files' and private.storage_can_upload(name));
create policy clinic_files_branding_read on storage.objects for select to authenticated
  using (bucket_id = 'clinic-files' and split_part(name, '/', 1) = 'branding' and private.is_active_user());
create policy clinic_files_branding_update on storage.objects for update to authenticated
  using (bucket_id = 'clinic-files' and split_part(name, '/', 1) = 'branding' and private.can('settings.organization'))
  with check (bucket_id = 'clinic-files' and split_part(name, '/', 1) = 'branding' and private.can('settings.organization'));

-- -----------------------------------------------------------------------------
-- Retention (scheduled by operators as the service role)
-- -----------------------------------------------------------------------------
create or replace function public.purge_expired_audit_events()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_count bigint;
begin
  perform set_config('vaidyora.audit_purge', 'on', true);
  delete from public.audit_events e
  where e.created_at < now() - make_interval(days => (select s.audit_retention_days from public.clinic_settings s));
  get diagnostics v_count = row_count;
  perform set_config('vaidyora.audit_purge', 'off', true);
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public;
grant execute on function private.storage_can_upload(text) to authenticated;

revoke execute on function public.org_overview(uuid, date, date), public.branch_metrics(date, date),
  public.clinic_trends(uuid, date, date, text), public.revenue_report(uuid, date, date),
  public.payment_method_report(uuid, date, date), public.appointment_status_report(uuid, date, date),
  public.clinical_report(uuid, date, date), public.staff_activity(date, date), public.doctor_overview(),
  public.my_recent_patients(integer), public.purge_expired_audit_events() from public, anon, authenticated;
grant execute on function public.org_overview(uuid, date, date), public.branch_metrics(date, date),
  public.clinic_trends(uuid, date, date, text), public.revenue_report(uuid, date, date),
  public.payment_method_report(uuid, date, date), public.appointment_status_report(uuid, date, date),
  public.clinical_report(uuid, date, date), public.staff_activity(date, date), public.doctor_overview(),
  public.my_recent_patients(integer) to authenticated;
grant execute on function public.purge_expired_audit_events() to service_role;
