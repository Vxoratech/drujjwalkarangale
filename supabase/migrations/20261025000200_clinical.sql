-- =============================================================================
-- Vaidyora — 0002 Patients, appointments and clinical records
-- =============================================================================

create type public.gender as enum ('female', 'male', 'other', 'undisclosed');
create type public.dosha as enum ('vata', 'pitta', 'kapha');
create type public.prakriti as enum (
  'vata', 'pitta', 'kapha', 'vata_pitta', 'pitta_kapha', 'vata_kapha', 'sama'
);
create type public.appointment_type as enum ('new_visit', 'follow_up', 'panchakarma', 'teleconsultation');
create type public.appointment_status as enum (
  'scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show'
);
create type public.record_status as enum ('draft', 'finalized');
create type public.agni as enum ('sama', 'vishama', 'tikshna', 'manda');
create type public.koshtha as enum ('mridu', 'madhyama', 'krura');
create type public.bala as enum ('pravara', 'madhyama', 'avara');
create type public.prescription_status as enum ('draft', 'issued', 'cancelled');
create type public.medicine_form as enum (
  'churna', 'vati', 'kashaya', 'arishta_asava', 'ghrita', 'taila', 'bhasma', 'lehya', 'syrup', 'other'
);
create type public.dose_timing as enum ('before_food', 'after_food', 'with_food', 'empty_stomach', 'bedtime', 'as_directed');
create type public.investigation_status as enum ('ordered', 'sample_collected', 'resulted', 'cancelled');
create type public.investigation_category as enum ('laboratory', 'imaging', 'other');

-- -----------------------------------------------------------------------------
-- Patients
-- -----------------------------------------------------------------------------
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  branch_id uuid,
  patient_code text not null,
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  date_of_birth date check (date_of_birth between date '1900-01-01' and current_date),
  gender public.gender not null default 'undisclosed',
  phone text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address_line text check (char_length(address_line) <= 240),
  city text check (char_length(city) <= 80),
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies text check (char_length(allergies) <= 1000),
  chronic_conditions text check (char_length(chronic_conditions) <= 1000),
  emergency_contact_name text check (char_length(emergency_contact_name) <= 120),
  emergency_contact_phone text check (emergency_contact_phone ~ '^\+?[0-9 -]{7,20}$'),
  prakriti public.prakriti,
  assigned_doctor_id uuid,
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'mr')),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, patient_code),
  foreign key (branch_id, clinic_id) references public.branches (id, clinic_id),
  foreign key (clinic_id, assigned_doctor_id) references public.clinic_members (clinic_id, user_id)
);
create index patients_clinic_name_idx on public.patients (clinic_id, lower(first_name), lower(last_name));
create index patients_clinic_phone_idx on public.patients (clinic_id, phone);
create index patients_assigned_doctor_idx on public.patients (clinic_id, assigned_doctor_id);

create or replace function private.assign_patient_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.patient_code := 'P-' || lpad(private.next_number(new.clinic_id, 'patient')::text, 6, '0');
  return new;
end;
$$;
create trigger patients_code before insert on public.patients
  for each row execute function private.assign_patient_code();
create trigger patients_updated_at before update on public.patients
  for each row execute function private.set_updated_at();
create trigger patients_clinic_immutable before update on public.patients
  for each row execute function private.prevent_clinic_change();

-- -----------------------------------------------------------------------------
-- Appointments
-- -----------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  branch_id uuid,
  patient_id uuid not null,
  doctor_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  type public.appointment_type not null default 'new_visit',
  status public.appointment_status not null default 'scheduled',
  reason text check (char_length(reason) <= 500),
  cancellation_reason text check (char_length(cancellation_reason) <= 500),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  check (ends_at > starts_at and ends_at - starts_at <= interval '8 hours'),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (branch_id, clinic_id) references public.branches (id, clinic_id),
  foreign key (clinic_id, doctor_id) references public.clinic_members (clinic_id, user_id),
  -- A doctor cannot be double-booked (cancelled / no-show slots are released).
  constraint appointments_no_overlap exclude using gist (
    doctor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status not in ('cancelled', 'no_show'))
);
create index appointments_clinic_start_idx on public.appointments (clinic_id, starts_at);
create index appointments_doctor_start_idx on public.appointments (doctor_id, starts_at);
create index appointments_patient_idx on public.appointments (patient_id);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();
create trigger appointments_clinic_immutable before update on public.appointments
  for each row execute function private.prevent_clinic_change();

create or replace function private.validate_appointment_doctor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(new.clinic_id, new.doctor_id, 'doctor') then
    raise exception 'Selected practitioner is not an active doctor in this clinic' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger appointments_validate_doctor before insert or update of doctor_id on public.appointments
  for each row execute function private.validate_appointment_doctor();

-- Patient-level access: a doctor may see a patient assigned to them or one they
-- have an appointment with. Security definer avoids recursive RLS evaluation.
create or replace function private.is_doctor_of_patient(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.patients p
    where p.id = p_patient and p.assigned_doctor_id = auth.uid()
  ) or exists (
    select 1 from public.appointments a
    where a.patient_id = p_patient and a.doctor_id = auth.uid()
  );
$$;

create or replace function private.can_read_patient(p_clinic uuid, p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_clinic, 'patients.read_all')
      or (private.has_permission(p_clinic, 'patients.read_assigned') and private.is_doctor_of_patient(p_patient));
$$;

create or replace function private.can_read_clinical(p_clinic uuid, p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_clinic, 'clinical.read_all')
      or (private.has_permission(p_clinic, 'clinical.read_assigned') and private.is_doctor_of_patient(p_patient));
$$;

create or replace function private.can_write_clinical(p_clinic uuid, p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_clinic, 'clinical.write')
     and (private.has_permission(p_clinic, 'clinical.read_all') or private.is_doctor_of_patient(p_patient));
$$;

-- Status transitions are enforced by trigger, so every path (direct update,
-- RPC, finalize_consultation) obeys the same state machine.
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
  if new.status = 'cancelled' and coalesce(trim(new.cancellation_reason), '') = '' then
    raise exception 'A cancellation reason is required' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger appointments_validate_status before update of status on public.appointments
  for each row execute function private.validate_appointment_status();

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

  if not private.has_permission(v_appt.clinic_id, 'appointments.manage') and not (
    v_appt.doctor_id = auth.uid() and private.has_permission(v_appt.clinic_id, 'appointments.update_own')
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

-- -----------------------------------------------------------------------------
-- Consultations (one per visit) and Ayurvedic examinations
-- -----------------------------------------------------------------------------
create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  patient_id uuid not null,
  doctor_id uuid not null,
  appointment_id uuid unique,
  status public.record_status not null default 'draft',
  visit_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  chief_complaint text not null check (char_length(chief_complaint) between 1 and 2000),
  history_of_present_illness text check (char_length(history_of_present_illness) <= 5000),
  past_history text check (char_length(past_history) <= 5000),
  -- Vitals
  pulse_bpm smallint check (pulse_bpm between 20 and 250),
  bp_systolic smallint check (bp_systolic between 50 and 260),
  bp_diastolic smallint check (bp_diastolic between 30 and 180),
  temperature_c numeric(4, 1) check (temperature_c between 30 and 45),
  weight_kg numeric(5, 2) check (weight_kg between 0.5 and 400),
  height_cm numeric(5, 1) check (height_cm between 30 and 260),
  spo2_percent smallint check (spo2_percent between 50 and 100),
  -- Assessment and plan
  clinical_findings text check (char_length(clinical_findings) <= 5000),
  diagnosis text check (char_length(diagnosis) <= 1000),
  ayurvedic_diagnosis text check (char_length(ayurvedic_diagnosis) <= 1000),
  treatment_plan text check (char_length(treatment_plan) <= 5000),
  pathya text check (char_length(pathya) <= 2000),
  apathya text check (char_length(apathya) <= 2000),
  follow_up_date date,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  check (follow_up_date is null or follow_up_date >= visit_date),
  check ((status = 'finalized') = (finalized_at is not null)),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (appointment_id, clinic_id) references public.appointments (id, clinic_id),
  foreign key (clinic_id, doctor_id) references public.clinic_members (clinic_id, user_id)
);
create index consultations_patient_idx on public.consultations (patient_id, visit_date desc);
create index consultations_doctor_idx on public.consultations (clinic_id, doctor_id, visit_date desc);
create index consultations_follow_up_idx on public.consultations (clinic_id, follow_up_date) where follow_up_date is not null;
create trigger consultations_updated_at before update on public.consultations
  for each row execute function private.set_updated_at();
create trigger consultations_clinic_immutable before update on public.consultations
  for each row execute function private.prevent_clinic_change();

create table public.ayurvedic_examinations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  consultation_id uuid not null unique,
  patient_id uuid not null,
  prakriti public.prakriti,
  vikriti public.dosha[] not null default '{}',
  agni public.agni,
  koshtha public.koshtha,
  bala public.bala,
  -- Ashtavidha Pariksha (eight-fold examination)
  nadi text check (char_length(nadi) <= 500),
  mutra text check (char_length(mutra) <= 500),
  mala text check (char_length(mala) <= 500),
  jihva text check (char_length(jihva) <= 500),
  shabda text check (char_length(shabda) <= 500),
  sparsha text check (char_length(sparsha) <= 500),
  drik text check (char_length(drik) <= 500),
  akriti text check (char_length(akriti) <= 500),
  -- Additional Dashavidha parameters
  sara text check (char_length(sara) <= 500),
  satva text check (char_length(satva) <= 500),
  notes text check (char_length(notes) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (consultation_id, clinic_id) references public.consultations (id, clinic_id) on delete cascade,
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id)
);
create trigger ayurvedic_examinations_updated_at before update on public.ayurvedic_examinations
  for each row execute function private.set_updated_at();
create trigger ayurvedic_examinations_clinic_immutable before update on public.ayurvedic_examinations
  for each row execute function private.prevent_clinic_change();

-- Finalized clinical records are immutable (medico-legal requirement).
create or replace function private.lock_finalized_consultation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'finalized' then
    raise exception 'Finalized consultations cannot be modified' using errcode = '42501';
  end if;
  if new.status = 'finalized' and new.finalized_at is null then
    new.finalized_at := now();
  end if;
  return new;
end;
$$;
create trigger consultations_lock before update on public.consultations
  for each row execute function private.lock_finalized_consultation();

create or replace function private.lock_examination_of_finalized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.consultations c
    where c.id = coalesce(new.consultation_id, old.consultation_id) and c.status = 'finalized'
  ) then
    raise exception 'Examination belongs to a finalized consultation' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger ayurvedic_examinations_lock before insert or update on public.ayurvedic_examinations
  for each row execute function private.lock_examination_of_finalized();

create or replace function public.finalize_consultation(p_consultation uuid)
returns public.consultations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.consultations;
begin
  select * into v_row from public.consultations where id = p_consultation for update;
  if not found or v_row.doctor_id <> auth.uid()
     or not private.has_permission(v_row.clinic_id, 'clinical.write') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_row.status = 'finalized' then
    return v_row;
  end if;

  update public.consultations set status = 'finalized', finalized_at = now()
   where id = p_consultation returning * into v_row;

  -- Close the visit if the appointment is still open.
  if v_row.appointment_id is not null then
    update public.appointments set status = 'completed'
     where id = v_row.appointment_id and status in ('scheduled', 'checked_in', 'in_consultation');
  end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Prescriptions
-- -----------------------------------------------------------------------------
create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  patient_id uuid not null,
  doctor_id uuid not null,
  consultation_id uuid,
  prescription_no text,
  status public.prescription_status not null default 'draft',
  notes text check (char_length(notes) <= 2000),
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, prescription_no),
  check ((status = 'issued') = (issued_at is not null and prescription_no is not null) or status = 'cancelled'),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (consultation_id, clinic_id) references public.consultations (id, clinic_id),
  foreign key (clinic_id, doctor_id) references public.clinic_members (clinic_id, user_id)
);
create index prescriptions_patient_idx on public.prescriptions (patient_id, created_at desc);
create trigger prescriptions_updated_at before update on public.prescriptions
  for each row execute function private.set_updated_at();
create trigger prescriptions_clinic_immutable before update on public.prescriptions
  for each row execute function private.prevent_clinic_change();

create table public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  prescription_id uuid not null,
  position smallint not null default 0,
  medicine_name text not null check (char_length(medicine_name) between 1 and 160),
  form public.medicine_form not null default 'other',
  dose text not null check (char_length(dose) between 1 and 80),
  frequency text not null check (char_length(frequency) between 1 and 80),
  timing public.dose_timing not null default 'after_food',
  anupana text check (char_length(anupana) <= 120),
  duration_days smallint check (duration_days between 1 and 365),
  instructions text check (char_length(instructions) <= 500),
  foreign key (prescription_id, clinic_id) references public.prescriptions (id, clinic_id) on delete cascade
);
create index prescription_items_rx_idx on public.prescription_items (prescription_id, position);

create or replace function private.lock_issued_prescription()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and not (old.status = 'issued' and new.status = 'cancelled') then
    raise exception 'Issued prescriptions can only be cancelled' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger prescriptions_lock before update on public.prescriptions
  for each row execute function private.lock_issued_prescription();

create or replace function private.lock_items_of_issued_prescription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.prescriptions p
    where p.id = coalesce(new.prescription_id, old.prescription_id) and p.status <> 'draft'
  ) then
    raise exception 'Items of an issued prescription cannot be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger prescription_items_lock before insert or update or delete on public.prescription_items
  for each row execute function private.lock_items_of_issued_prescription();

create or replace function public.issue_prescription(p_prescription uuid)
returns public.prescriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.prescriptions;
begin
  select * into v_row from public.prescriptions where id = p_prescription for update;
  if not found or v_row.doctor_id <> auth.uid()
     or not private.has_permission(v_row.clinic_id, 'clinical.write') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Only draft prescriptions can be issued' using errcode = '23514';
  end if;
  if not exists (select 1 from public.prescription_items i where i.prescription_id = p_prescription) then
    raise exception 'Add at least one medicine before issuing' using errcode = '23514';
  end if;

  update public.prescriptions
     set status = 'issued',
         issued_at = now(),
         prescription_no = 'RX-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-'
                           || lpad(private.next_number(v_row.clinic_id, 'prescription')::text, 6, '0')
   where id = p_prescription
   returning * into v_row;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Investigations
-- -----------------------------------------------------------------------------
create table public.investigations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  patient_id uuid not null,
  consultation_id uuid,
  ordered_by uuid not null default auth.uid(),
  test_name text not null check (char_length(test_name) between 2 and 160),
  category public.investigation_category not null default 'laboratory',
  status public.investigation_status not null default 'ordered',
  instructions text check (char_length(instructions) <= 1000),
  result_summary text check (char_length(result_summary) <= 5000),
  result_file_path text,
  ordered_at timestamptz not null default now(),
  resulted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'resulted') = (resulted_at is not null)),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (consultation_id, clinic_id) references public.consultations (id, clinic_id),
  foreign key (clinic_id, ordered_by) references public.clinic_members (clinic_id, user_id)
);
create index investigations_patient_idx on public.investigations (patient_id, ordered_at desc);
create index investigations_open_idx on public.investigations (clinic_id, status) where status in ('ordered', 'sample_collected');
create trigger investigations_updated_at before update on public.investigations
  for each row execute function private.set_updated_at();
create trigger investigations_clinic_immutable before update on public.investigations
  for each row execute function private.prevent_clinic_change();

create or replace function private.stamp_investigation_result()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'resulted' and new.resulted_at is null then
    new.resulted_at := now();
  elsif new.status <> 'resulted' then
    new.resulted_at := null;
  end if;
  return new;
end;
$$;
create trigger investigations_stamp before insert or update on public.investigations
  for each row execute function private.stamp_investigation_result();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.consultations enable row level security;
alter table public.ayurvedic_examinations enable row level security;
alter table public.prescriptions enable row level security;
alter table public.prescription_items enable row level security;
alter table public.investigations enable row level security;

-- Patients
create policy patients_select on public.patients for select to authenticated
  using (
    private.has_permission(clinic_id, 'patients.read_all')
    or (
      private.has_permission(clinic_id, 'patients.read_assigned')
      -- Inline check keeps INSERT … RETURNING working for a freshly created row.
      and (assigned_doctor_id = auth.uid() or private.is_doctor_of_patient(id))
    )
  );
create policy patients_insert on public.patients for insert to authenticated
  with check (
    private.has_permission(clinic_id, 'patients.create')
    and (
      private.has_permission(clinic_id, 'patients.read_all')
      -- Doctors without clinic-wide access can only register patients to themselves.
      or assigned_doctor_id = auth.uid()
    )
  );
create policy patients_update on public.patients for update to authenticated
  using (
    private.has_permission(clinic_id, 'patients.update')
    and private.can_read_patient(clinic_id, id)
  )
  with check (
    private.has_permission(clinic_id, 'patients.update')
    and (private.has_permission(clinic_id, 'patients.read_all') or assigned_doctor_id = auth.uid())
  );

-- Appointments
create policy appointments_select on public.appointments for select to authenticated
  using (
    private.has_permission(clinic_id, 'appointments.read_all')
    or (doctor_id = auth.uid() and private.has_permission(clinic_id, 'appointments.read_own'))
  );
create policy appointments_insert on public.appointments for insert to authenticated
  with check (private.has_permission(clinic_id, 'appointments.manage') and status = 'scheduled');
create policy appointments_update on public.appointments for update to authenticated
  using (private.has_permission(clinic_id, 'appointments.manage') and status in ('scheduled', 'checked_in'))
  with check (private.has_permission(clinic_id, 'appointments.manage'));

-- Consultations: doctors write their own; reads follow clinical access.
create policy consultations_select on public.consultations for select to authenticated
  using (private.can_read_clinical(clinic_id, patient_id));
create policy consultations_insert on public.consultations for insert to authenticated
  with check (
    doctor_id = auth.uid() and status = 'draft'
    and private.can_write_clinical(clinic_id, patient_id)
  );
create policy consultations_update on public.consultations for update to authenticated
  using (doctor_id = auth.uid() and status = 'draft' and private.has_permission(clinic_id, 'clinical.write'))
  with check (doctor_id = auth.uid() and status = 'draft');

create policy examinations_select on public.ayurvedic_examinations for select to authenticated
  using (private.can_read_clinical(clinic_id, patient_id));
create policy examinations_write on public.ayurvedic_examinations for insert to authenticated
  with check (exists (
    select 1 from public.consultations c
    where c.id = consultation_id and c.patient_id = ayurvedic_examinations.patient_id
      and c.doctor_id = auth.uid() and c.status = 'draft'
  ) and private.has_permission(clinic_id, 'clinical.write'));
create policy examinations_update on public.ayurvedic_examinations for update to authenticated
  using (exists (
    select 1 from public.consultations c
    where c.id = consultation_id and c.doctor_id = auth.uid() and c.status = 'draft'
  ))
  with check (private.has_permission(clinic_id, 'clinical.write'));

-- Prescriptions
create policy prescriptions_select on public.prescriptions for select to authenticated
  using (private.can_read_clinical(clinic_id, patient_id) or private.has_permission(clinic_id, 'prescriptions.read_all'));
create policy prescriptions_insert on public.prescriptions for insert to authenticated
  with check (
    doctor_id = auth.uid() and status = 'draft' and prescription_no is null
    and private.can_write_clinical(clinic_id, patient_id)
  );
-- Issuing (numbering) happens only through issue_prescription().
create policy prescriptions_update on public.prescriptions for update to authenticated
  using (doctor_id = auth.uid() and private.has_permission(clinic_id, 'clinical.write'))
  with check (
    doctor_id = auth.uid()
    and ((status = 'draft' and prescription_no is null) or status = 'cancelled')
  );

create policy prescription_items_select on public.prescription_items for select to authenticated
  using (exists (select 1 from public.prescriptions p where p.id = prescription_id));
create policy prescription_items_insert on public.prescription_items for insert to authenticated
  with check (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id and p.doctor_id = auth.uid() and p.status = 'draft'
  ));
create policy prescription_items_update on public.prescription_items for update to authenticated
  using (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id and p.doctor_id = auth.uid() and p.status = 'draft'
  ));
create policy prescription_items_delete on public.prescription_items for delete to authenticated
  using (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id and p.doctor_id = auth.uid() and p.status = 'draft'
  ));

-- Investigations
create policy investigations_select on public.investigations for select to authenticated
  using (private.can_read_clinical(clinic_id, patient_id));
create policy investigations_insert on public.investigations for insert to authenticated
  with check (ordered_by = auth.uid() and private.can_write_clinical(clinic_id, patient_id));
create policy investigations_update on public.investigations for update to authenticated
  using (private.can_write_clinical(clinic_id, patient_id))
  with check (private.can_write_clinical(clinic_id, patient_id));

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on public.patients, public.appointments, public.consultations, public.ayurvedic_examinations,
  public.prescriptions, public.prescription_items, public.investigations from anon;
grant select, insert, update on public.patients, public.appointments, public.consultations,
  public.ayurvedic_examinations, public.prescriptions, public.investigations to authenticated;
grant select, insert, update, delete on public.prescription_items to authenticated;

revoke execute on all functions in schema private from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;
grant execute on function private.has_role(uuid, uuid, public.app_role) to authenticated;
grant execute on function private.shares_clinic(uuid) to authenticated;
grant execute on function private.is_doctor_of_patient(uuid) to authenticated;
grant execute on function private.can_read_patient(uuid, uuid) to authenticated;
grant execute on function private.can_read_clinical(uuid, uuid) to authenticated;
grant execute on function private.can_write_clinical(uuid, uuid) to authenticated;

revoke execute on function public.set_appointment_status(uuid, public.appointment_status, text) from public, anon;
revoke execute on function public.finalize_consultation(uuid) from public, anon;
revoke execute on function public.issue_prescription(uuid) from public, anon;
grant execute on function public.set_appointment_status(uuid, public.appointment_status, text) to authenticated;
grant execute on function public.finalize_consultation(uuid) to authenticated;
grant execute on function public.issue_prescription(uuid) to authenticated;
