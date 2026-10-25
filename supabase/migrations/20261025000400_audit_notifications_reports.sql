-- =============================================================================
-- Vaidyora — 0004 Audit log, notifications, storage, permissions, reports
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit log
-- Records WHO did WHAT to WHICH record and the NAMES of changed columns.
-- Column values are intentionally not stored so the log never holds PHI.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity_type text not null,
  entity_id uuid,
  changed_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_clinic_created_idx on public.audit_logs (clinic_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[] := '{}';
  v_clinic uuid;
begin
  v_clinic := case when tg_table_name = 'clinics' then (v_row ->> 'id')::uuid
                   else (v_row ->> 'clinic_id')::uuid end;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at') and n.value is distinct from v_old -> n.key;
    if cardinality(v_changed) = 0 then
      return new;
    end if;
  end if;

  insert into public.audit_logs (clinic_id, actor_id, action, entity_type, entity_id, changed_fields)
  values (v_clinic, auth.uid(), lower(tg_op), tg_table_name, (v_row ->> 'id')::uuid, v_changed);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'clinics', 'branches', 'clinic_members', 'patients', 'appointments', 'consultations',
    'ayurvedic_examinations', 'prescriptions', 'investigations', 'invoices', 'payments'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()',
      t || '_audit', t
    );
  end loop;
end;
$$;

alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (private.has_permission(clinic_id, 'audit.read'));
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

-- -----------------------------------------------------------------------------
-- In-app notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('appointment_booked', 'appointment_cancelled', 'investigation_resulted', 'system')),
  -- Titles are generic by design; no patient names are written here.
  title text not null check (char_length(title) <= 160),
  link text check (link ~ '^/[A-Za-z0-9/_?=&-]*$'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create or replace function private.notify_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.doctor_id is distinct from auth.uid() then
    insert into public.notifications (clinic_id, user_id, kind, title, link)
    values (new.clinic_id, new.doctor_id, 'appointment_booked', 'New appointment booked',
            '/appointments/' || new.id);
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled'
        and new.doctor_id is distinct from auth.uid() then
    insert into public.notifications (clinic_id, user_id, kind, title, link)
    values (new.clinic_id, new.doctor_id, 'appointment_cancelled', 'An appointment was cancelled',
            '/appointments/' || new.id);
  end if;
  return new;
end;
$$;
create trigger appointments_notify after insert or update of status on public.appointments
  for each row execute function private.notify_appointment();

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: one private bucket; first path segment is the clinic id.
--   {clinic_id}/branding/...                 → members read, settings.manage write
--   {clinic_id}/patients/{patient_id}/...    → clinical access rules
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-files', 'clinic-files', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create or replace function private.storage_can_read(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_clinic uuid;
begin
  begin
    v_clinic := v_parts[1]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if v_parts[2] = 'branding' then
    return private.is_member(v_clinic);
  elsif v_parts[2] = 'patients' and cardinality(v_parts) >= 4 then
    return private.can_read_clinical(v_clinic, v_parts[3]::uuid);
  end if;
  return false;
end;
$$;

create or replace function private.storage_can_write(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_clinic uuid;
begin
  begin
    v_clinic := v_parts[1]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if v_parts[2] = 'branding' then
    return private.has_permission(v_clinic, 'settings.manage');
  elsif v_parts[2] = 'patients' and cardinality(v_parts) >= 4 then
    return private.can_write_clinical(v_clinic, v_parts[3]::uuid);
  end if;
  return false;
end;
$$;

create policy clinic_files_read on storage.objects for select to authenticated
  using (bucket_id = 'clinic-files' and private.storage_can_read(name));
create policy clinic_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinic-files' and private.storage_can_write(name));
create policy clinic_files_update on storage.objects for update to authenticated
  using (bucket_id = 'clinic-files' and private.storage_can_write(name))
  with check (bucket_id = 'clinic-files' and private.storage_can_write(name));

-- -----------------------------------------------------------------------------
-- Permission catalogue and default role mapping (reference data)
-- -----------------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('patients.read_all', 'View every patient in the clinic'),
  ('patients.read_assigned', 'View patients assigned to or booked with me'),
  ('patients.create', 'Register patients'),
  ('patients.update', 'Edit patient demographics'),
  ('appointments.read_all', 'View the whole clinic schedule'),
  ('appointments.read_own', 'View my own schedule'),
  ('appointments.manage', 'Book, reschedule and cancel appointments'),
  ('appointments.update_own', 'Update status of my own appointments'),
  ('clinical.read_all', 'View all clinical records'),
  ('clinical.read_assigned', 'View clinical records of my patients'),
  ('clinical.write', 'Write consultations, examinations, prescriptions, investigations'),
  ('prescriptions.read_all', 'View issued prescriptions (dispensing)'),
  ('billing.read', 'View invoices and payments'),
  ('billing.create', 'Create invoices'),
  ('billing.void', 'Void unpaid invoices'),
  ('payments.record', 'Record payments'),
  ('reports.read', 'View business reports'),
  ('settings.manage', 'Manage clinic profile, branches and branding'),
  ('users.read', 'View staff roster'),
  ('users.manage', 'Invite staff and change roles'),
  ('audit.read', 'View the audit log')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role, permission)
select r.role::public.app_role, unnest(r.perms)
from (values
  ('admin', array[
    'patients.read_all', 'patients.create', 'patients.update',
    'appointments.read_all', 'appointments.manage',
    'billing.read', 'billing.create', 'billing.void', 'payments.record',
    'reports.read', 'settings.manage', 'users.read', 'users.manage', 'audit.read']),
  ('doctor', array[
    'patients.read_assigned', 'patients.create', 'patients.update',
    'appointments.read_own', 'appointments.update_own',
    'clinical.read_assigned', 'clinical.write']),
  -- Future roles: mappings ship now so enabling them is a data change only.
  ('receptionist', array[
    'patients.read_all', 'patients.create', 'patients.update',
    'appointments.read_all', 'appointments.manage',
    'billing.read', 'billing.create', 'payments.record', 'users.read']),
  ('accountant', array['patients.read_all', 'billing.read', 'billing.create', 'billing.void', 'payments.record', 'reports.read']),
  ('pharmacist', array['patients.read_all', 'prescriptions.read_all']),
  ('branch_manager', array[
    'patients.read_all', 'patients.create', 'patients.update',
    'appointments.read_all', 'appointments.manage',
    'billing.read', 'billing.create', 'payments.record', 'reports.read', 'users.read'])
  -- super_admin is a platform role handled outside tenant RLS; no clinic grants.
) as r(role, perms)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Reports (SECURITY INVOKER — results are automatically scoped by RLS)
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_clinic uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select (now() at time zone 'Asia/Kolkata')::date as today,
           date_trunc('month', now() at time zone 'Asia/Kolkata')::date as month_start
  )
  select jsonb_build_object(
    'appointments_today', (
      select count(*) from public.appointments a, bounds b
      where a.clinic_id = p_clinic and (a.starts_at at time zone 'Asia/Kolkata')::date = b.today
        and a.status not in ('cancelled', 'no_show')),
    'appointments_remaining_today', (
      select count(*) from public.appointments a, bounds b
      where a.clinic_id = p_clinic and (a.starts_at at time zone 'Asia/Kolkata')::date = b.today
        and a.status in ('scheduled', 'checked_in', 'in_consultation')),
    'patients_total', (
      select count(*) from public.patients p where p.clinic_id = p_clinic and p.archived_at is null),
    'patients_new_this_month', (
      select count(*) from public.patients p, bounds b
      where p.clinic_id = p_clinic and p.created_at >= b.month_start),
    'collected_this_month_paise', (
      select coalesce(sum(pm.amount_paise), 0) from public.payments pm, bounds b
      where pm.clinic_id = p_clinic and pm.paid_at >= b.month_start),
    'outstanding_paise', (
      select coalesce(sum(i.total_paise - i.amount_paid_paise), 0) from public.invoices i
      where i.clinic_id = p_clinic and i.status in ('issued', 'partially_paid')),
    'draft_consultations', (
      select count(*) from public.consultations c
      where c.clinic_id = p_clinic and c.doctor_id = auth.uid() and c.status = 'draft'),
    'follow_ups_next_7_days', (
      select count(*) from public.consultations c, bounds b
      where c.clinic_id = p_clinic and c.doctor_id = auth.uid()
        and c.follow_up_date between b.today and b.today + 7),
    'pending_investigations', (
      select count(*) from public.investigations iv
      where iv.clinic_id = p_clinic and iv.status in ('ordered', 'sample_collected'))
  );
$$;

create or replace function public.revenue_report(p_clinic uuid, p_from date, p_to date)
returns table (day date, invoiced_paise bigint, collected_paise bigint, invoice_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
                   where pm.clinic_id = p_clinic and (pm.paid_at at time zone 'Asia/Kolkata')::date = d::date), 0)::bigint,
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
begin
  if not private.has_permission(p_clinic, 'reports.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select pm.method, sum(pm.amount_paise)::bigint, count(*)
  from public.payments pm
  where pm.clinic_id = p_clinic
    and (pm.paid_at at time zone 'Asia/Kolkata')::date between p_from and p_to
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
begin
  if not private.has_permission(p_clinic, 'reports.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select a.status, count(*)
  from public.appointments a
  where a.clinic_id = p_clinic
    and (a.starts_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  group by a.status
  order by 2 desc;
end;
$$;

revoke execute on all functions in schema private from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;
grant execute on function private.has_role(uuid, uuid, public.app_role) to authenticated;
grant execute on function private.shares_clinic(uuid) to authenticated;
grant execute on function private.is_doctor_of_patient(uuid) to authenticated;
grant execute on function private.can_read_patient(uuid, uuid) to authenticated;
grant execute on function private.can_read_clinical(uuid, uuid) to authenticated;
grant execute on function private.can_write_clinical(uuid, uuid) to authenticated;
grant execute on function private.storage_can_read(text) to authenticated;
grant execute on function private.storage_can_write(text) to authenticated;

revoke execute on function public.dashboard_summary(uuid) from public, anon;
revoke execute on function public.revenue_report(uuid, date, date) from public, anon;
revoke execute on function public.payment_method_report(uuid, date, date) from public, anon;
revoke execute on function public.appointment_status_report(uuid, date, date) from public, anon;
grant execute on function public.dashboard_summary(uuid) to authenticated;
grant execute on function public.revenue_report(uuid, date, date) to authenticated;
grant execute on function public.payment_method_report(uuid, date, date) to authenticated;
grant execute on function public.appointment_status_report(uuid, date, date) to authenticated;
