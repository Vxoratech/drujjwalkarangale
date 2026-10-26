-- =============================================================================
-- Vaidyora — 0009 Patients, consent records, appointment details, branch scope
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Patients
-- -----------------------------------------------------------------------------
-- Status replaces archived_at. Patients are never hard-deleted: clinical
-- history must remain intact. "inactive" hides them from default lists;
-- reports still count their historical visits and invoices.
alter table public.patients
  add column status public.patient_status not null default 'active',
  add column status_changed_at timestamptz,
  add column occupation text check (char_length(occupation) <= 120),
  -- When the date of birth is unknown, an approximate age at registration.
  add column approx_age_years smallint check (approx_age_years between 0 and 130),
  add column registered_on date,
  add column updated_by uuid references auth.users (id) on delete set null,
  add constraint patients_age_representation check (date_of_birth is null or approx_age_years is null);

update public.patients set status = 'inactive', status_changed_at = archived_at where archived_at is not null;
update public.patients set registered_on = (created_at at time zone private.clinic_tz(clinic_id))::date;
alter table public.patients alter column registered_on set not null;
alter table public.patients drop column archived_at;
create index patients_clinic_status_idx on public.patients (clinic_id, status);

create or replace function private.patients_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.registered_on := coalesce(new.registered_on, private.clinic_today(new.clinic_id));
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
create trigger patients_defaults before insert or update on public.patients
  for each row execute function private.patients_defaults();
create trigger patients_updated_by before update on public.patients
  for each row execute function private.set_updated_by();

-- -----------------------------------------------------------------------------
-- Patient consents (append-only; withdrawal is the only permitted change)
-- -----------------------------------------------------------------------------
create table public.patient_consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  patient_id uuid not null,
  consent_type public.consent_type not null,
  status public.consent_status not null default 'granted',
  method public.consent_method not null,
  policy_version text not null check (char_length(policy_version) between 1 and 40),
  notes text check (char_length(notes) <= 500),
  granted_at timestamptz not null default now(),
  recorded_by uuid not null default auth.uid() references auth.users (id),
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id)
);
create index patient_consents_patient_idx on public.patient_consents (patient_id, consent_type, granted_at desc);
-- At most one live consent of each type per patient.
create unique index patient_consents_one_active on public.patient_consents (patient_id, consent_type) where status = 'granted';

create or replace function private.patient_consents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'withdrawn' then
    raise exception 'Withdrawn consents cannot be changed' using errcode = '42501';
  end if;
  if new.status <> 'withdrawn'
     or (to_jsonb(new) - array['status', 'withdrawn_at', 'withdrawn_by']) is distinct from (to_jsonb(old) - array['status', 'withdrawn_at', 'withdrawn_by']) then
    raise exception 'Consent records can only be withdrawn' using errcode = '42501';
  end if;
  new.withdrawn_at := now();
  new.withdrawn_by := auth.uid();
  return new;
end;
$$;
create trigger patient_consents_guard before update on public.patient_consents
  for each row execute function private.patient_consents_guard();

alter table public.patient_consents enable row level security;
create policy patient_consents_select on public.patient_consents for select to authenticated
  using (private.can_read_patient(clinic_id, patient_id));
create policy patient_consents_insert on public.patient_consents for insert to authenticated
  with check (
    private.has_permission(clinic_id, 'consents.manage') and private.can_read_patient(clinic_id, patient_id)
    and recorded_by = auth.uid() and status = 'granted'
  );
create policy patient_consents_update on public.patient_consents for update to authenticated
  using (private.has_permission(clinic_id, 'consents.manage') and private.can_read_patient(clinic_id, patient_id))
  with check (private.has_permission(clinic_id, 'consents.manage'));
revoke all on public.patient_consents from anon;
grant select, insert on public.patient_consents to authenticated;
grant update (status) on public.patient_consents to authenticated;

-- -----------------------------------------------------------------------------
-- Appointments
-- -----------------------------------------------------------------------------
alter table public.appointments
  add column source public.appointment_source not null default 'walk_in',
  add column notes text check (char_length(notes) <= 1000),
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users (id) on delete set null,
  add column updated_by uuid references auth.users (id) on delete set null,
  add constraint appointments_cancellation_details check (status <> 'cancelled' or cancelled_at is not null);

create trigger appointments_updated_by before update on public.appointments
  for each row execute function private.set_updated_by();

create or replace function private.validate_appointment_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed public.appointment_status[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'scheduled' then array['checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show']::public.appointment_status[]
    when 'checked_in' then array['in_consultation', 'completed', 'cancelled', 'no_show']::public.appointment_status[]
    when 'in_consultation' then array['completed']::public.appointment_status[]
    else array[]::public.appointment_status[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'Cannot change appointment from % to %', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'cancelled' then
    if coalesce(trim(new.cancellation_reason), '') = '' then
      raise exception 'A cancellation reason is required' using errcode = '23514';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Default the branch from the booking member, and keep it inside their scope.
create or replace function private.appointment_branch_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null then
    select m.default_branch_id into new.branch_id
    from public.clinic_members m where m.clinic_id = new.clinic_id and m.user_id = auth.uid();
  end if;
  return new;
end;
$$;
create trigger appointments_branch_default before insert on public.appointments
  for each row execute function private.appointment_branch_default();

drop policy appointments_select on public.appointments;
drop policy appointments_insert on public.appointments;
drop policy appointments_update on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
  using (
    private.in_branch_scope(clinic_id, branch_id) and (
      private.has_permission(clinic_id, 'appointments.read_all')
      or (doctor_id = auth.uid() and private.has_permission(clinic_id, 'appointments.read_own'))
    )
  );
create policy appointments_insert on public.appointments for insert to authenticated
  with check (
    private.has_permission(clinic_id, 'appointments.manage') and status = 'scheduled'
    and private.in_branch_scope(clinic_id, branch_id)
  );
create policy appointments_update on public.appointments for update to authenticated
  using (
    private.has_permission(clinic_id, 'appointments.manage') and status in ('scheduled', 'checked_in')
    and private.in_branch_scope(clinic_id, branch_id)
  )
  with check (private.has_permission(clinic_id, 'appointments.manage') and private.in_branch_scope(clinic_id, branch_id));

-- set_appointment_status() also honours branch scope.
create or replace function public.set_appointment_status(
  p_appointment uuid,
  p_status public.appointment_status,
  p_reason text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments;
begin
  select * into v_appt from public.appointments where id = p_appointment for update;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;

  if not private.in_branch_scope(v_appt.clinic_id, v_appt.branch_id) or (
    not private.has_permission(v_appt.clinic_id, 'appointments.manage') and not (
      v_appt.doctor_id = auth.uid() and private.has_permission(v_appt.clinic_id, 'appointments.update_own')
    )
  ) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  update public.appointments
     set status = p_status,
         cancellation_reason = case when p_status = 'cancelled' then left(trim(p_reason), 500) else cancellation_reason end
   where id = p_appointment
   returning * into v_appt;
  return v_appt;
end;
$$;
