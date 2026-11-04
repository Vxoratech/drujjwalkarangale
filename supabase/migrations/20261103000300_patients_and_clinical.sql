-- =============================================================================
-- Vaidyora — 0300 Patients, scheduling and clinical records
-- =============================================================================
-- One central patient profile per person. Visit-level rows (appointments,
-- consultations, prescriptions, investigations, documents, follow-ups) carry
-- the branch that handled them. Clinical writes are doctor-only permissions;
-- clinical reads need a clinical view permission plus branch scope.
-- =============================================================================

create type public.gender as enum ('female', 'male', 'other', 'undisclosed');
create type public.patient_status as enum ('active', 'inactive', 'deceased');
create type public.dosha as enum ('vata', 'pitta', 'kapha');
create type public.prakriti as enum ('vata', 'pitta', 'kapha', 'vata_pitta', 'pitta_kapha', 'vata_kapha', 'sama');
create type public.consent_type as enum ('treatment', 'data_processing', 'sms_reminders', 'whatsapp_reminders', 'clinical_photography');
create type public.consent_status as enum ('granted', 'withdrawn');
create type public.consent_method as enum ('verbal', 'written', 'digital');
create type public.appointment_type as enum ('new_visit', 'follow_up', 'panchakarma', 'teleconsultation');
create type public.appointment_status as enum ('scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show');
create type public.appointment_source as enum ('walk_in', 'phone', 'online', 'referral', 'follow_up', 'other');
create type public.record_status as enum ('draft', 'finalized');
create type public.agni as enum ('sama', 'vishama', 'tikshna', 'manda');
create type public.koshtha as enum ('mridu', 'madhyama', 'krura');
create type public.bala as enum ('pravara', 'madhyama', 'avara');
create type public.ama_level as enum ('absent', 'mild', 'moderate', 'severe');
create type public.exam_field_type as enum ('text', 'number', 'select', 'boolean');
create type public.prescription_status as enum ('draft', 'issued', 'cancelled');
create type public.medicine_form as enum ('churna', 'vati', 'kashaya', 'arishta_asava', 'ghrita', 'taila', 'bhasma', 'lehya', 'syrup', 'other');
create type public.medicine_route as enum ('oral', 'topical', 'nasal', 'rectal', 'ophthalmic', 'otic', 'other');
create type public.dose_timing as enum ('before_food', 'after_food', 'with_food', 'empty_stomach', 'bedtime', 'as_directed');
create type public.investigation_status as enum ('ordered', 'sample_collected', 'resulted', 'cancelled');
create type public.investigation_category as enum ('laboratory', 'imaging', 'other');
create type public.document_category as enum ('lab_report', 'imaging', 'external_prescription', 'consent_form', 'clinical_photo', 'other');
create type public.followup_status as enum ('pending', 'booked', 'completed', 'cancelled');

-- Default a visit-level row's branch from its parent, else the primary branch.
create or replace function private.default_branch_from_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(new);
begin
  if new.branch_id is null and v_row ? 'appointment_id' and (v_row ->> 'appointment_id') is not null then
    select a.branch_id into new.branch_id from public.appointments a where a.id = (v_row ->> 'appointment_id')::uuid;
  end if;
  if new.branch_id is null and v_row ? 'consultation_id' and (v_row ->> 'consultation_id') is not null then
    select c.branch_id into new.branch_id from public.consultations c where c.id = (v_row ->> 'consultation_id')::uuid;
  end if;
  new.branch_id := coalesce(new.branch_id, private.primary_branch());
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Patients
-- -----------------------------------------------------------------------------
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  patient_code text not null unique,
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  date_of_birth date check (date_of_birth between '1900-01-01' and current_date),
  approx_age_years smallint check (approx_age_years between 0 and 130),
  gender public.gender not null default 'undisclosed',
  phone text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address_line text check (char_length(address_line) <= 240),
  city text check (char_length(city) <= 80),
  occupation text check (char_length(occupation) <= 120),
  emergency_contact_name text check (char_length(emergency_contact_name) <= 120),
  emergency_contact_phone text check (emergency_contact_phone ~ '^\+?[0-9 -]{7,20}$'),
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'mr')),
  registered_branch_id uuid not null references public.clinic_branches (id),
  registered_on date not null,
  status public.patient_status not null default 'active',
  status_changed_at timestamptz,
  duplicate_reviewed boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint patients_age_representation check (date_of_birth is null or approx_age_years is null)
);
create index patients_name_trgm_idx on public.patients using gin ((lower(first_name || ' ' || last_name)) extensions.gin_trgm_ops);
create index patients_name_idx on public.patients (lower(first_name), lower(last_name));
create index patients_phone_idx on public.patients (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10));
create index patients_status_idx on public.patients (status);
create index patients_branch_idx on public.patients (registered_branch_id);

create or replace function private.patients_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.patient_code := 'P-' || lpad(private.next_number('patient')::text, 6, '0');
    new.registered_on := coalesce(new.registered_on, private.org_today());
    new.registered_branch_id := coalesce(new.registered_branch_id, private.primary_branch());
  else
    if new.patient_code is distinct from old.patient_code then
      raise exception 'Patient IDs cannot be changed' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      new.status_changed_at := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger patients_defaults before insert or update on public.patients
  for each row execute function private.patients_defaults();
create trigger patients_updated_at before update on public.patients
  for each row execute function private.set_updated_at();
create trigger patients_updated_by before update on public.patients
  for each row execute function private.set_updated_by();
create trigger patients_audit after insert or update or delete on public.patients
  for each row execute function private.audit_row();

-- "Edit contact" may change contact fields only; full edits and archiving
-- need their own permissions.
create or replace function private.guard_patient_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_contact text[] := array['phone', 'email', 'address_line', 'city', 'emergency_contact_name', 'emergency_contact_phone', 'preferred_locale', 'updated_at', 'updated_by', 'status_changed_at'];
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.status is distinct from old.status and not (private.can('patients.delete') or private.can('patients.edit')) then
    raise exception 'Not permitted to change patient status' using errcode = '42501';
  end if;
  if not private.can('patients.edit')
     and (to_jsonb(new) - v_contact - 'status') is distinct from (to_jsonb(old) - v_contact - 'status') then
    raise exception 'Not permitted to change these patient details' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status' - 'status_changed_at' - 'updated_at' - 'updated_by') is distinct from (to_jsonb(old) - 'status' - 'status_changed_at' - 'updated_at' - 'updated_by')
     and not (private.can('patients.edit') or private.can('patients.edit_contact')) then
    raise exception 'Not permitted to edit patients' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger patients_guard_update before update on public.patients
  for each row execute function private.guard_patient_update();

-- Medical background lives apart from contact details so that front-desk
-- access to a patient never includes their history.
create table public.patient_medical_profiles (
  patient_id uuid primary key references public.patients (id) on delete cascade,
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies text check (char_length(allergies) <= 1000),
  chronic_conditions text check (char_length(chronic_conditions) <= 1000),
  prakriti public.prakriti,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create trigger patient_medical_profiles_updated_at before update on public.patient_medical_profiles
  for each row execute function private.set_updated_at();
create trigger patient_medical_profiles_updated_by before update on public.patient_medical_profiles
  for each row execute function private.set_updated_by();
create trigger patient_medical_profiles_audit after insert or update on public.patient_medical_profiles
  for each row execute function private.audit_row();

create table public.patient_consents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
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
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);
create index patient_consents_patient_idx on public.patient_consents (patient_id, consent_type, granted_at desc);
create unique index patient_consents_one_active on public.patient_consents (patient_id, consent_type) where status = 'granted';

create or replace function private.patient_consents_guard()
returns trigger language plpgsql set search_path = '' as $$
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
create trigger patient_consents_audit after insert or update on public.patient_consents
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Appointments (all with Dr. Ujjwal, so no two may overlap anywhere)
-- -----------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.clinic_branches (id),
  patient_id uuid not null references public.patients (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  type public.appointment_type not null default 'new_visit',
  status public.appointment_status not null default 'scheduled',
  source public.appointment_source not null default 'walk_in',
  reason text check (char_length(reason) <= 500),
  notes text check (char_length(notes) <= 1000),
  cancellation_reason text check (char_length(cancellation_reason) <= 500),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (ends_at > starts_at and ends_at - starts_at <= interval '8 hours'),
  constraint appointments_cancellation_details check (status <> 'cancelled' or cancelled_at is not null),
  constraint appointments_no_overlap exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
    where (status not in ('cancelled', 'no_show'))
);
create index appointments_branch_start_idx on public.appointments (branch_id, starts_at);
create index appointments_start_idx on public.appointments (starts_at);
create index appointments_patient_idx on public.appointments (patient_id, starts_at desc);

create trigger appointments_branch_default before insert on public.appointments
  for each row execute function private.default_branch_from_parent();
create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();
create trigger appointments_updated_by before update on public.appointments
  for each row execute function private.set_updated_by();
create trigger appointments_audit after insert or update or delete on public.appointments
  for each row execute function private.audit_row();

-- Bookings go to active branches and, when the branch has published working
-- hours, inside them (clinic time zone).
create or replace function private.validate_appointment_slot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_start timestamp := new.starts_at at time zone v_tz;
  v_end timestamp := new.ends_at at time zone v_tz;
begin
  if tg_op = 'UPDATE' and new.starts_at = old.starts_at and new.ends_at = old.ends_at and new.branch_id = old.branch_id then
    return new;
  end if;
  if not exists (select 1 from public.clinic_branches b where b.id = new.branch_id and b.is_active) then
    raise exception 'This branch is not accepting appointments' using errcode = '23514';
  end if;
  if exists (select 1 from public.branch_working_hours h where h.branch_id = new.branch_id)
     and not exists (
       select 1 from public.branch_working_hours h
       where h.branch_id = new.branch_id and h.weekday = extract(isodow from v_start)
         and v_start::date = v_end::date and v_start::time >= h.opens_at and v_end::time <= h.closes_at) then
    raise exception 'The appointment is outside the branch working hours' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger appointments_validate_slot before insert or update of starts_at, ends_at, branch_id on public.appointments
  for each row execute function private.validate_appointment_slot();

create or replace function private.validate_appointment_status()
returns trigger language plpgsql set search_path = '' as $$
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
create trigger appointments_validate_status before update of status on public.appointments
  for each row execute function private.validate_appointment_status();

-- -----------------------------------------------------------------------------
-- Consultations (रुग्णपत्रिका) and amendments
-- -----------------------------------------------------------------------------
create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  appointment_id uuid unique references public.appointments (id),
  branch_id uuid not null references public.clinic_branches (id),
  status public.record_status not null default 'draft',
  visit_date date not null,
  chief_complaint text not null check (char_length(chief_complaint) between 1 and 2000),
  pain_details text check (char_length(pain_details) <= 2000),
  history_of_present_illness text check (char_length(history_of_present_illness) <= 5000),
  past_history text check (char_length(past_history) <= 5000),
  pulse_bpm smallint check (pulse_bpm between 20 and 250),
  bp_systolic smallint check (bp_systolic between 50 and 260),
  bp_diastolic smallint check (bp_diastolic between 30 and 180),
  temperature_c numeric(4, 1) check (temperature_c between 30 and 45),
  weight_kg numeric(5, 1) check (weight_kg between 0.5 and 400),
  height_cm numeric(5, 1) check (height_cm between 30 and 260),
  spo2_percent smallint check (spo2_percent between 50 and 100),
  clinical_findings text check (char_length(clinical_findings) <= 5000),
  assessment text check (char_length(assessment) <= 3000),
  diagnosis text check (char_length(diagnosis) <= 1000),
  ayurvedic_diagnosis text check (char_length(ayurvedic_diagnosis) <= 1000),
  treatment_plan text check (char_length(treatment_plan) <= 5000),
  pathya text check (char_length(pathya) <= 2000),
  apathya text check (char_length(apathya) <= 2000),
  doctor_notes text check (char_length(doctor_notes) <= 5000),
  follow_up_date date,
  finalized_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (follow_up_date is null or follow_up_date >= visit_date),
  check ((status = 'finalized') = (finalized_at is not null))
);
create index consultations_patient_idx on public.consultations (patient_id, visit_date desc);
create index consultations_branch_idx on public.consultations (branch_id, visit_date desc);
create index consultations_open_idx on public.consultations (status) where status = 'draft';

create or replace function private.consultations_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.visit_date := coalesce(new.visit_date, private.org_today());
  return new;
end;
$$;
create trigger consultations_defaults before insert on public.consultations
  for each row execute function private.consultations_defaults();
create trigger consultations_branch_default before insert on public.consultations
  for each row execute function private.default_branch_from_parent();

create or replace function private.lock_finalized_consultation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'finalized' then
    raise exception 'Finalized consultations cannot be modified' using errcode = '42501';
  end if;
  if new.status = 'finalized' and new.finalized_at is null then
    new.finalized_at := now();
  end if;
  if new.branch_id is distinct from old.branch_id or new.patient_id is distinct from old.patient_id then
    raise exception 'The patient and branch of a consultation cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger consultations_lock before update on public.consultations
  for each row execute function private.lock_finalized_consultation();
create trigger consultations_updated_at before update on public.consultations
  for each row execute function private.set_updated_at();
create trigger consultations_updated_by before update on public.consultations
  for each row execute function private.set_updated_by();
create trigger consultations_audit after insert or update or delete on public.consultations
  for each row execute function private.audit_row();

create table public.consultation_amendments (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id),
  author_id uuid not null default auth.uid() references auth.users (id),
  reason text not null check (char_length(reason) between 1 and 300),
  content text not null check (char_length(content) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index consultation_amendments_consultation_idx on public.consultation_amendments (consultation_id, created_at);
create trigger consultation_amendments_immutable before update or delete on public.consultation_amendments
  for each row execute function private.immutable_row();
create trigger consultation_amendments_audit after insert on public.consultation_amendments
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Ayurvedic examination, with clinic-defined extra fields
-- -----------------------------------------------------------------------------
create table public.exam_field_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_en text not null check (char_length(label_en) between 1 and 80),
  label_mr text check (char_length(label_mr) <= 80),
  field_type public.exam_field_type not null default 'text',
  options jsonb check (options is null or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 30)),
  unit text check (char_length(unit) <= 20),
  position smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check ((field_type = 'select') = (options is not null))
);
create trigger exam_field_definitions_updated_at before update on public.exam_field_definitions
  for each row execute function private.set_updated_at();
create trigger exam_field_definitions_updated_by before update on public.exam_field_definitions
  for each row execute function private.set_updated_by();
create trigger exam_field_definitions_audit after insert or update on public.exam_field_definitions
  for each row execute function private.audit_row();

create table public.ayurvedic_examinations (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null unique references public.consultations (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  prakriti public.prakriti,
  vikriti public.dosha[] not null default '{}',
  vata_score smallint check (vata_score between 0 and 10),
  pitta_score smallint check (pitta_score between 0 and 10),
  kapha_score smallint check (kapha_score between 0 and 10),
  agni public.agni,
  koshtha public.koshtha,
  bala public.bala,
  ama public.ama_level,
  nadi text check (char_length(nadi) <= 500),
  mutra text check (char_length(mutra) <= 500),
  mala text check (char_length(mala) <= 500),
  jihva text check (char_length(jihva) <= 500),
  shabda text check (char_length(shabda) <= 500),
  sparsha text check (char_length(sparsha) <= 500),
  drik text check (char_length(drik) <= 500),
  akriti text check (char_length(akriti) <= 500),
  sara text check (char_length(sara) <= 500),
  satva text check (char_length(satva) <= 500),
  nidra text check (char_length(nidra) <= 500),
  appetite text check (char_length(appetite) <= 500),
  digestion text check (char_length(digestion) <= 500),
  bowel_habits text check (char_length(bowel_habits) <= 500),
  dinacharya text check (char_length(dinacharya) <= 1000),
  lifestyle text check (char_length(lifestyle) <= 1000),
  general_examination text check (char_length(general_examination) <= 2000),
  family_history text check (char_length(family_history) <= 1000),
  family_history_maternal text check (char_length(family_history_maternal) <= 1000),
  family_history_paternal text check (char_length(family_history_paternal) <= 1000),
  family_history_self text check (char_length(family_history_self) <= 1000),
  menstrual_history text check (char_length(menstrual_history) <= 1000),
  custom_fields jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object' and pg_column_size(custom_fields) <= 16384),
  notes text check (char_length(notes) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create or replace function private.lock_examination_of_finalized()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.consultations c where c.id = new.consultation_id and c.status = 'finalized') then
    raise exception 'Examination belongs to a finalized consultation' using errcode = '42501';
  end if;
  if not exists (select 1 from public.consultations c where c.id = new.consultation_id and c.patient_id = new.patient_id) then
    raise exception 'Examination and consultation belong to different patients' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger ayurvedic_examinations_lock before insert or update on public.ayurvedic_examinations
  for each row execute function private.lock_examination_of_finalized();

create or replace function private.validate_exam_custom_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_value jsonb;
  v_def public.exam_field_definitions;
begin
  for v_key, v_value in select * from jsonb_each(new.custom_fields) loop
    select * into v_def from public.exam_field_definitions d where d.key = v_key and d.is_active;
    if not found then
      raise exception 'Unknown examination field: %', v_key using errcode = '23514';
    end if;
    if jsonb_typeof(v_value) = 'null' then
      continue;
    end if;
    if (v_def.field_type = 'number' and jsonb_typeof(v_value) <> 'number')
       or (v_def.field_type = 'boolean' and jsonb_typeof(v_value) <> 'boolean')
       or (v_def.field_type = 'text' and (jsonb_typeof(v_value) <> 'string' or char_length(v_value #>> '{}') > 1000))
       or (v_def.field_type = 'select' and not (v_def.options @> jsonb_build_array(v_value))) then
      raise exception 'Invalid value for examination field: %', v_key using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
create trigger ayurvedic_examinations_custom_fields before insert or update of custom_fields on public.ayurvedic_examinations
  for each row execute function private.validate_exam_custom_fields();
create trigger ayurvedic_examinations_updated_at before update on public.ayurvedic_examinations
  for each row execute function private.set_updated_at();
create trigger ayurvedic_examinations_updated_by before update on public.ayurvedic_examinations
  for each row execute function private.set_updated_by();
create trigger ayurvedic_examinations_audit after insert or update or delete on public.ayurvedic_examinations
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Prescriptions, items, issued revisions and the doctor's templates
-- -----------------------------------------------------------------------------
create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  consultation_id uuid references public.consultations (id),
  branch_id uuid not null references public.clinic_branches (id),
  prescription_no text unique,
  status public.prescription_status not null default 'draft',
  language text not null default 'en' check (language in ('en', 'mr')),
  notes text check (char_length(notes) <= 2000),
  patient_instructions text check (char_length(patient_instructions) <= 2000),
  follow_up_date date,
  revision_number integer not null default 1 check (revision_number >= 1),
  revision_reason text check (char_length(revision_reason) <= 500),
  issued_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (((status = 'issued') = (issued_at is not null and prescription_no is not null)) or status = 'cancelled')
);
create index prescriptions_patient_idx on public.prescriptions (patient_id, created_at desc);
create index prescriptions_branch_idx on public.prescriptions (branch_id, issued_at desc);
create index prescriptions_drafts_idx on public.prescriptions (status) where status = 'draft';

create trigger prescriptions_branch_default before insert on public.prescriptions
  for each row execute function private.default_branch_from_parent();

create or replace function private.lock_issued_prescription()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('vaidyora.rx_rpc', true), '') = 'on' then
    return new;
  end if;
  if new.prescription_no is distinct from old.prescription_no
     or new.issued_at is distinct from old.issued_at
     or new.revision_number is distinct from old.revision_number
     or new.patient_id is distinct from old.patient_id
     or (new.status = 'issued' and old.status <> 'issued') then
    raise exception 'Prescriptions are issued and revised only through the issue and revise actions' using errcode = '42501';
  end if;
  if old.status <> 'draft' and not (old.status = 'issued' and new.status = 'cancelled') then
    raise exception 'Issued prescriptions can only be cancelled or revised' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger prescriptions_lock before update on public.prescriptions
  for each row execute function private.lock_issued_prescription();
create trigger prescriptions_updated_at before update on public.prescriptions
  for each row execute function private.set_updated_at();
create trigger prescriptions_updated_by before update on public.prescriptions
  for each row execute function private.set_updated_by();
create trigger prescriptions_audit after insert or update or delete on public.prescriptions
  for each row execute function private.audit_row();

create table public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions (id) on delete cascade,
  position smallint not null default 0,
  medicine_name text not null check (char_length(medicine_name) between 1 and 160),
  form public.medicine_form not null default 'other',
  route public.medicine_route not null default 'oral',
  dose text not null check (char_length(dose) between 1 and 80),
  quantity text check (char_length(quantity) <= 40),
  frequency text not null check (char_length(frequency) between 1 and 80),
  timing public.dose_timing not null default 'after_food',
  anupana text check (char_length(anupana) <= 120),
  duration_days smallint check (duration_days between 1 and 365),
  instructions_en text check (char_length(instructions_en) <= 500),
  instructions_mr text check (char_length(instructions_mr) <= 500)
);
create index prescription_items_rx_idx on public.prescription_items (prescription_id, position);

create or replace function private.lock_items_of_issued_prescription()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.prescriptions p where p.id = coalesce(new.prescription_id, old.prescription_id) and p.status <> 'draft') then
    raise exception 'Items of an issued prescription cannot be changed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger prescription_items_lock before insert or update or delete on public.prescription_items
  for each row execute function private.lock_items_of_issued_prescription();

create table public.prescription_revisions (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions (id),
  revision_number integer not null check (revision_number >= 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  revision_reason text,
  issued_by uuid not null references auth.users (id),
  issued_at timestamptz not null default now(),
  unique (prescription_id, revision_number)
);
create trigger prescription_revisions_immutable before update or delete on public.prescription_revisions
  for each row execute function private.immutable_row();
create trigger prescription_revisions_audit after insert on public.prescription_revisions
  for each row execute function private.audit_row();

create table public.prescription_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 500),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  patient_instructions text check (char_length(patient_instructions) <= 2000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.validate_template_items()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from jsonb_populate_recordset(null::public.prescription_items, new.items) r
    where coalesce(trim(r.medicine_name), '') = '' or coalesce(trim(r.dose), '') = '' or coalesce(trim(r.frequency), '') = ''
  ) then
    raise exception 'Every template item needs a medicine, dose and frequency' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger prescription_templates_validate before insert or update of items on public.prescription_templates
  for each row execute function private.validate_template_items();
create trigger prescription_templates_updated_at before update on public.prescription_templates
  for each row execute function private.set_updated_at();
create trigger prescription_templates_audit after insert or update or delete on public.prescription_templates
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Investigations, documents and follow-ups
-- -----------------------------------------------------------------------------
create table public.investigations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  consultation_id uuid references public.consultations (id),
  branch_id uuid not null references public.clinic_branches (id),
  ordered_by uuid not null default auth.uid() references auth.users (id),
  test_name text not null check (char_length(test_name) between 2 and 160),
  category public.investigation_category not null default 'laboratory',
  status public.investigation_status not null default 'ordered',
  instructions text check (char_length(instructions) <= 1000),
  result_summary text check (char_length(result_summary) <= 5000),
  notes text check (char_length(notes) <= 2000),
  ordered_at timestamptz not null default now(),
  resulted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check ((status = 'resulted') = (resulted_at is not null))
);
create index investigations_patient_idx on public.investigations (patient_id, ordered_at desc);
create index investigations_open_idx on public.investigations (branch_id, status) where status in ('ordered', 'sample_collected');

create trigger investigations_branch_default before insert on public.investigations
  for each row execute function private.default_branch_from_parent();

create or replace function private.investigations_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'resulted' and new.resulted_at is null then
    new.resulted_at := now();
  elsif new.status <> 'resulted' then
    new.resulted_at := null;
  end if;
  -- Tracking staff move a test through its states; results and orders are clinical.
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') and not private.can('investigations.order')
     and (to_jsonb(new) - array['status', 'resulted_at', 'updated_at', 'updated_by'])
         is distinct from (to_jsonb(old) - array['status', 'resulted_at', 'updated_at', 'updated_by']) then
    raise exception 'Only the doctor can change investigation details' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger investigations_guard before insert or update on public.investigations
  for each row execute function private.investigations_guard();
create trigger investigations_updated_at before update on public.investigations
  for each row execute function private.set_updated_at();
create trigger investigations_updated_by before update on public.investigations
  for each row execute function private.set_updated_by();
create trigger investigations_audit after insert or update or delete on public.investigations
  for each row execute function private.audit_row();

create table public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  investigation_id uuid references public.investigations (id),
  consultation_id uuid references public.consultations (id),
  branch_id uuid not null references public.clinic_branches (id),
  category public.document_category not null default 'other',
  title text not null check (char_length(title) between 1 and 160),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  storage_path text unique,
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  uploaded_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id),
  delete_reason text check (char_length(delete_reason) <= 300),
  created_at timestamptz not null default now(),
  constraint patient_documents_safe_file_name check (file_name !~ '[/\\[:cntrl:]]' and file_name !~ '^\.'),
  check ((deleted_at is null) = (delete_reason is null))
);
create index patient_documents_patient_idx on public.patient_documents (patient_id, created_at desc) where deleted_at is null;
create index patient_documents_investigation_idx on public.patient_documents (investigation_id) where investigation_id is not null;

create trigger patient_documents_branch_default before insert on public.patient_documents
  for each row execute function private.default_branch_from_parent();

create or replace function private.patient_documents_path()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.storage_path := 'patients/' || new.patient_id || '/' || new.id || '.' ||
    case new.mime_type when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' else 'webp' end;
  return new;
end;
$$;
create trigger patient_documents_path before insert on public.patient_documents
  for each row execute function private.patient_documents_path();

create or replace function private.patient_documents_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['uploaded_at', 'deleted_at', 'deleted_by', 'delete_reason'])
     is distinct from (to_jsonb(old) - array['uploaded_at', 'deleted_at', 'deleted_by', 'delete_reason']) then
    raise exception 'Document metadata cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger patient_documents_guard before update on public.patient_documents
  for each row execute function private.patient_documents_guard();
create trigger patient_documents_audit after insert or update or delete on public.patient_documents
  for each row execute function private.audit_row();

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  consultation_id uuid unique references public.consultations (id),
  appointment_id uuid unique references public.appointments (id),
  branch_id uuid not null references public.clinic_branches (id),
  due_date date not null,
  reason text check (char_length(reason) <= 300),
  status public.followup_status not null default 'pending',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check ((status = 'booked') <= (appointment_id is not null))
);
create index follow_ups_due_idx on public.follow_ups (status, due_date);
create index follow_ups_branch_idx on public.follow_ups (branch_id, status, due_date);
create index follow_ups_patient_idx on public.follow_ups (patient_id);

create trigger follow_ups_branch_default before insert on public.follow_ups
  for each row execute function private.default_branch_from_parent();
create trigger follow_ups_updated_at before update on public.follow_ups
  for each row execute function private.set_updated_at();
create trigger follow_ups_updated_by before update on public.follow_ups
  for each row execute function private.set_updated_by();
create trigger follow_ups_audit after insert or update or delete on public.follow_ups
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Patient and clinical visibility
-- -----------------------------------------------------------------------------
-- Has the patient been seen at one of the caller's branches?
create or replace function private.patient_in_my_branches(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_all_branches()
      or exists (select 1 from public.patients p where p.id = p_patient and p.registered_branch_id in (select private.my_branch_ids()))
      or exists (select 1 from public.appointments a where a.patient_id = p_patient and a.branch_id in (select private.my_branch_ids()))
      or exists (select 1 from public.consultations c where c.patient_id = p_patient and c.branch_id in (select private.my_branch_ids()));
$$;

-- Basic profile: organization-wide for patients.view_basic, so returning
-- patients are found at any branch. Extended in 0400 for billing staff.
create or replace function private.can_see_patient(p_patient uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return private.can('patients.view_basic');
end;
$$;

-- Patient-level clinical data (history, examinations, documents without a
-- branch): the clinical permission plus a visit at one of the caller's branches.
create or replace function private.can_view_clinical(p_permission text, p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can(p_permission) and private.patient_in_my_branches(p_patient);
$$;

-- -----------------------------------------------------------------------------
-- Transactional RPCs
-- -----------------------------------------------------------------------------
-- Possible duplicates for a registration: same phone, or a similar name with
-- a matching date of birth / age. Nothing is ever merged automatically.
create or replace function public.find_possible_duplicates(
  p_first_name text, p_last_name text default '', p_phone text default null,
  p_date_of_birth date default null, p_approx_age smallint default null
)
returns table (patient_id uuid, patient_code text, first_name text, last_name text, phone text,
               date_of_birth date, registered_branch text, match_reasons text[], score numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_name text := lower(trim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '')));
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
begin
  if not (private.can('patients.view_basic') or private.can('patients.create')) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  with c as (
    select p.*, extensions.similarity(lower(p.first_name || ' ' || p.last_name), v_name) as sim,
           (char_length(v_phone) = 10 and right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone) as same_phone,
           (p_date_of_birth is not null and p.date_of_birth = p_date_of_birth) as same_dob,
           (p_approx_age is not null and abs(coalesce(p.approx_age_years,
              extract(year from age(private.org_today(), p.date_of_birth))::smallint) - p_approx_age) <= 2) as similar_age
    from public.patients p
    where p.status <> 'deceased'
  )
  select c.id, c.patient_code, c.first_name, c.last_name, c.phone, c.date_of_birth,
         (select b.name from public.clinic_branches b where b.id = c.registered_branch_id),
         array_remove(array[
           case when c.same_phone then 'phone' end,
           case when c.sim >= 0.45 then 'name' end,
           case when c.same_dob then 'date_of_birth' end,
           case when c.similar_age then 'age' end], null),
         round((case when c.same_phone then 0.6 else 0 end + c.sim * 0.4
                + case when c.same_dob then 0.3 when c.similar_age then 0.1 else 0 end)::numeric, 2)
  from c
  where c.same_phone or (c.sim >= 0.6) or (c.sim >= 0.45 and (c.same_dob or c.similar_age))
  order by 9 desc
  limit 10;
end;
$$;

-- Registration with a server-side duplicate check: when matches exist the
-- caller must confirm they reviewed them.
create or replace function public.register_patient(p_patient jsonb, p_branch uuid default null, p_duplicate_reviewed boolean default false, p_medical jsonb default null)
returns public.patients language plpgsql security definer set search_path = '' as $$
declare
  r public.patients := jsonb_populate_record(null::public.patients, p_patient);
  v_row public.patients;
  v_branch uuid := coalesce(p_branch, private.primary_branch());
begin
  if not private.can_at('patients.create', v_branch) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not coalesce(p_duplicate_reviewed, false) and exists (
    select 1 from public.find_possible_duplicates(r.first_name, r.last_name, r.phone, r.date_of_birth, r.approx_age_years)
  ) then
    raise exception 'Possible duplicate patients found; review them before registering' using errcode = 'P0003';
  end if;

  insert into public.patients (first_name, last_name, date_of_birth, approx_age_years, gender, phone, email, address_line, city,
    occupation, emergency_contact_name, emergency_contact_phone, preferred_locale, registered_branch_id, duplicate_reviewed, created_by)
  values (trim(r.first_name), coalesce(trim(r.last_name), ''), r.date_of_birth, r.approx_age_years, coalesce(r.gender, 'undisclosed'),
    nullif(trim(r.phone), ''), nullif(trim(r.email), ''), nullif(trim(r.address_line), ''), nullif(trim(r.city), ''),
    nullif(trim(r.occupation), ''), nullif(trim(r.emergency_contact_name), ''), nullif(trim(r.emergency_contact_phone), ''),
    coalesce(r.preferred_locale, 'en'), v_branch, coalesce(p_duplicate_reviewed, false), auth.uid())
  returning * into v_row;

  if p_medical is not null and private.can('consultations.edit') then
    insert into public.patient_medical_profiles (patient_id, blood_group, allergies, chronic_conditions, prakriti)
    select v_row.id, m.blood_group, m.allergies, m.chronic_conditions, m.prakriti
    from jsonb_populate_record(null::public.patient_medical_profiles, p_medical) m;
  end if;
  if coalesce(p_duplicate_reviewed, false) then
    perform private.log_event('patients.duplicate_reviewed', 'insert', 'patients', v_row.id, '{}', '{}', v_branch);
  end if;
  return v_row;
end;
$$;

-- Opening a profile is audited (once per 10 minutes per patient) and rate-limited.
create or replace function private.log_patient_view(p_patient uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_see_patient(p_patient) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not private.hit_rate_limit('patient_view:' || auth.uid(), 300, 600) then
    perform private.log_event('security.rate_limited', 'security', 'patients', p_patient, '{}', jsonb_build_object('limit', 'patient_view'));
    return false;
  end if;
  if not exists (
    select 1 from public.audit_events e
    where e.actor_id = auth.uid() and e.event_type = 'patients.viewed' and e.entity_id = p_patient
      and e.created_at > now() - interval '10 minutes'
  ) then
    perform private.log_event('patients.viewed', 'view', 'patients', p_patient);
  end if;
  return true;
end;
$$;

create or replace function public.view_patient(p_patient uuid)
returns public.patients language plpgsql set search_path = '' as $$
declare
  v_row public.patients;
begin
  select * into v_row from public.patients where id = p_patient;
  if not found then
    raise exception 'The record could not be found' using errcode = 'P0002';
  end if;
  if not private.log_patient_view(v_row.id) then
    return null; -- rate-limited; the refusal has been audited
  end if;
  return v_row;
end;
$$;

create or replace function public.save_medical_profile(p_patient uuid, p_medical jsonb)
returns public.patient_medical_profiles language plpgsql set search_path = '' as $$
declare
  m public.patient_medical_profiles := jsonb_populate_record(null::public.patient_medical_profiles, p_medical);
  v_row public.patient_medical_profiles;
begin
  insert into public.patient_medical_profiles (patient_id, blood_group, allergies, chronic_conditions, prakriti)
  values (p_patient, m.blood_group, nullif(trim(m.allergies), ''), nullif(trim(m.chronic_conditions), ''), m.prakriti)
  on conflict (patient_id) do update set blood_group = excluded.blood_group, allergies = excluded.allergies,
    chronic_conditions = excluded.chronic_conditions, prakriti = excluded.prakriti
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.set_appointment_status(p_appointment uuid, p_status public.appointment_status, p_reason text default null)
returns public.appointments language plpgsql security definer set search_path = '' as $$
declare
  v_appt public.appointments;
  v_perm text := case p_status
    when 'cancelled' then 'appointments.cancel'
    when 'in_consultation' then 'consultations.create'
    else 'appointments.update_status' end;
begin
  select * into v_appt from public.appointments where id = p_appointment for update;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;
  if not private.can_at(v_perm, v_appt.branch_id)
     and not (p_status = 'completed' and private.can('consultations.edit')) then
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

create or replace function public.save_consultation(p_id uuid, p_data jsonb, p_exam jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  r public.consultations := jsonb_populate_record(null::public.consultations, p_data);
  e public.ayurvedic_examinations := jsonb_populate_record(null::public.ayurvedic_examinations, coalesce(p_exam, '{}'::jsonb));
  v_id uuid;
begin
  if p_id is null then
    insert into public.consultations (
      patient_id, appointment_id, branch_id, chief_complaint, pain_details, history_of_present_illness, past_history,
      pulse_bpm, bp_systolic, bp_diastolic, temperature_c, weight_kg, height_cm, spo2_percent,
      clinical_findings, assessment, diagnosis, ayurvedic_diagnosis, treatment_plan, pathya, apathya, follow_up_date, doctor_notes
    ) values (
      r.patient_id, r.appointment_id, r.branch_id, r.chief_complaint, r.pain_details, r.history_of_present_illness, r.past_history,
      r.pulse_bpm, r.bp_systolic, r.bp_diastolic, r.temperature_c, r.weight_kg, r.height_cm, r.spo2_percent,
      r.clinical_findings, r.assessment, r.diagnosis, r.ayurvedic_diagnosis, r.treatment_plan, r.pathya, r.apathya, r.follow_up_date, r.doctor_notes
    ) returning id into v_id;

    if r.appointment_id is not null then
      perform public.set_appointment_status(r.appointment_id, 'in_consultation')
      from public.appointments a where a.id = r.appointment_id and a.status in ('scheduled', 'checked_in');
    end if;
  else
    update public.consultations set
      chief_complaint = r.chief_complaint, pain_details = r.pain_details,
      history_of_present_illness = r.history_of_present_illness, past_history = r.past_history,
      pulse_bpm = r.pulse_bpm, bp_systolic = r.bp_systolic, bp_diastolic = r.bp_diastolic,
      temperature_c = r.temperature_c, weight_kg = r.weight_kg, height_cm = r.height_cm, spo2_percent = r.spo2_percent,
      clinical_findings = r.clinical_findings, assessment = r.assessment, diagnosis = r.diagnosis,
      ayurvedic_diagnosis = r.ayurvedic_diagnosis, treatment_plan = r.treatment_plan,
      pathya = r.pathya, apathya = r.apathya, follow_up_date = r.follow_up_date, doctor_notes = r.doctor_notes
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
  end if;

  insert into public.ayurvedic_examinations (
    consultation_id, patient_id, prakriti, vikriti, agni, koshtha, bala, vata_score, pitta_score, kapha_score, ama,
    nadi, mutra, mala, jihva, shabda, sparsha, drik, akriti, sara, satva,
    nidra, appetite, digestion, bowel_habits, dinacharya, lifestyle, general_examination, family_history,
    family_history_maternal, family_history_paternal, family_history_self, menstrual_history, custom_fields, notes
  )
  select v_id, c.patient_id, e.prakriti, coalesce(e.vikriti, '{}'), e.agni, e.koshtha, e.bala, e.vata_score, e.pitta_score, e.kapha_score, e.ama,
         e.nadi, e.mutra, e.mala, e.jihva, e.shabda, e.sparsha, e.drik, e.akriti, e.sara, e.satva,
         e.nidra, e.appetite, e.digestion, e.bowel_habits, e.dinacharya, e.lifestyle, e.general_examination, e.family_history,
         e.family_history_maternal, e.family_history_paternal, e.family_history_self, e.menstrual_history,
         coalesce(e.custom_fields, '{}'), e.notes
  from public.consultations c where c.id = v_id
  on conflict (consultation_id) do update set
    prakriti = excluded.prakriti, vikriti = excluded.vikriti, agni = excluded.agni, koshtha = excluded.koshtha,
    bala = excluded.bala, vata_score = excluded.vata_score, pitta_score = excluded.pitta_score,
    kapha_score = excluded.kapha_score, ama = excluded.ama,
    nadi = excluded.nadi, mutra = excluded.mutra, mala = excluded.mala, jihva = excluded.jihva,
    shabda = excluded.shabda, sparsha = excluded.sparsha, drik = excluded.drik, akriti = excluded.akriti,
    sara = excluded.sara, satva = excluded.satva, nidra = excluded.nidra, appetite = excluded.appetite,
    digestion = excluded.digestion, bowel_habits = excluded.bowel_habits, dinacharya = excluded.dinacharya,
    lifestyle = excluded.lifestyle, general_examination = excluded.general_examination,
    family_history = excluded.family_history, family_history_maternal = excluded.family_history_maternal,
    family_history_paternal = excluded.family_history_paternal, family_history_self = excluded.family_history_self,
    menstrual_history = excluded.menstrual_history, custom_fields = excluded.custom_fields, notes = excluded.notes;

  return v_id;
end;
$$;

create or replace function public.finalize_consultation(p_consultation uuid)
returns public.consultations language plpgsql security definer set search_path = '' as $$
declare
  v_row public.consultations;
begin
  select * into v_row from public.consultations where id = p_consultation for update;
  if not found or not private.can('consultations.edit') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_row.status = 'finalized' then
    return v_row;
  end if;
  update public.consultations set status = 'finalized', finalized_at = now() where id = p_consultation returning * into v_row;
  if v_row.appointment_id is not null then
    update public.appointments set status = 'completed'
     where id = v_row.appointment_id and status in ('scheduled', 'checked_in', 'in_consultation');
    update public.follow_ups set status = 'completed' where appointment_id = v_row.appointment_id and status = 'booked';
  end if;
  if v_row.follow_up_date is not null then
    insert into public.follow_ups (patient_id, consultation_id, branch_id, due_date, created_by)
    values (v_row.patient_id, v_row.id, v_row.branch_id, v_row.follow_up_date, auth.uid())
    on conflict (consultation_id) do nothing;
  end if;
  return v_row;
end;
$$;

create or replace function public.save_prescription_draft(p_id uuid, p_patient uuid, p_consultation uuid, p_header jsonb, p_items jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  h public.prescriptions := jsonb_populate_record(null::public.prescriptions, coalesce(p_header, '{}'::jsonb));
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 50 then
    raise exception 'Too many line items' using errcode = '23514';
  end if;
  if p_id is null then
    insert into public.prescriptions (patient_id, consultation_id, branch_id, notes, language, patient_instructions, follow_up_date)
    values (p_patient, p_consultation, h.branch_id, nullif(trim(h.notes), ''), coalesce(h.language, 'en'),
            nullif(trim(h.patient_instructions), ''), h.follow_up_date)
    returning id into v_id;
  else
    update public.prescriptions
       set notes = nullif(trim(h.notes), ''), language = coalesce(h.language, 'en'),
           patient_instructions = nullif(trim(h.patient_instructions), ''), follow_up_date = h.follow_up_date
     where id = p_id and status = 'draft'
     returning id into v_id;
    if v_id is null then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    delete from public.prescription_items where prescription_id = v_id;
  end if;

  insert into public.prescription_items (prescription_id, position, medicine_name, form, route, dose, quantity, frequency, timing,
    anupana, duration_days, instructions_en, instructions_mr)
  select v_id, (i.ordinality - 1)::smallint, (i.r).medicine_name, coalesce((i.r).form, 'other'),
         coalesce((i.r).route, 'oral'), (i.r).dose, (i.r).quantity, (i.r).frequency, coalesce((i.r).timing, 'after_food'),
         (i.r).anupana, (i.r).duration_days, (i.r).instructions_en, (i.r).instructions_mr
  from (
    select jsonb_populate_record(null::public.prescription_items, x.value) as r, x.ordinality
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(value, ordinality)
  ) i;
  return v_id;
end;
$$;

create or replace function public.issue_prescription(p_prescription uuid, p_clinician_confirmed boolean)
returns public.prescriptions language plpgsql security definer set search_path = '' as $$
declare
  v_row public.prescriptions;
begin
  select * into v_row from public.prescriptions where id = p_prescription for update;
  if not found or not private.can('prescriptions.finalize') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not coalesce(p_clinician_confirmed, false) then
    raise exception 'Confirm that you have reviewed every medicine and dose' using errcode = '23514';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Only draft prescriptions can be issued' using errcode = '23514';
  end if;
  if not exists (select 1 from public.prescription_items i where i.prescription_id = p_prescription) then
    raise exception 'Add at least one medicine before issuing' using errcode = '23514';
  end if;

  perform set_config('vaidyora.rx_rpc', 'on', true);
  update public.prescriptions
     set status = 'issued', issued_at = now(),
         prescription_no = coalesce(prescription_no,
           'RX-' || to_char(now() at time zone private.org_tz(), 'YYYY') || '-' || lpad(private.next_number('prescription')::text, 6, '0'))
   where id = p_prescription
   returning * into v_row;
  perform set_config('vaidyora.rx_rpc', 'off', true);

  insert into public.prescription_revisions (prescription_id, revision_number, snapshot, revision_reason, issued_by, issued_at)
  values (v_row.id, v_row.revision_number,
    jsonb_build_object(
      'header', to_jsonb(v_row),
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.prescription_items i where i.prescription_id = v_row.id), '[]'),
      'clinician_confirmed', true),
    v_row.revision_reason, auth.uid(), v_row.issued_at);
  return v_row;
end;
$$;

create or replace function public.revise_prescription(p_prescription uuid, p_reason text)
returns public.prescriptions language plpgsql security definer set search_path = '' as $$
declare
  v_row public.prescriptions;
begin
  select * into v_row from public.prescriptions where id = p_prescription for update;
  if not found or not private.can('prescriptions.create') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_row.status <> 'issued' then
    raise exception 'Only issued prescriptions can be revised' using errcode = '23514';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to revise a prescription' using errcode = '23514';
  end if;
  perform set_config('vaidyora.rx_rpc', 'on', true);
  update public.prescriptions
     set status = 'draft', issued_at = null, revision_number = revision_number + 1, revision_reason = left(trim(p_reason), 500)
   where id = p_prescription
   returning * into v_row;
  perform set_config('vaidyora.rx_rpc', 'off', true);
  return v_row;
end;
$$;

create or replace function public.book_follow_up(p_follow_up uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_branch uuid default null, p_reason text default null)
returns uuid language plpgsql set search_path = '' as $$
declare
  f public.follow_ups;
  v_appt uuid;
begin
  if not private.can('follow_ups.manage') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select * into f from public.follow_ups where id = p_follow_up and status = 'pending' for update;
  if not found then
    raise exception 'Follow-up not found or already booked' using errcode = 'P0002';
  end if;
  insert into public.appointments (branch_id, patient_id, starts_at, ends_at, type, source, reason)
  values (coalesce(p_branch, f.branch_id), f.patient_id, p_starts_at, p_ends_at, 'follow_up', 'follow_up',
          coalesce(nullif(trim(p_reason), ''), f.reason))
  returning id into v_appt;
  update public.follow_ups set status = 'booked', appointment_id = v_appt where id = f.id;
  return v_appt;
end;
$$;

create or replace function public.confirm_document_upload(p_document uuid)
returns public.patient_documents language plpgsql security definer set search_path = '' as $$
declare
  d public.patient_documents;
begin
  select * into d from public.patient_documents where id = p_document for update;
  if not found or d.uploaded_by <> auth.uid() or not private.can_at('investigations.upload', d.branch_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if d.uploaded_at is not null then
    return d;
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'clinic-files' and o.name = d.storage_path) then
    raise exception 'The file has not been uploaded' using errcode = 'P0002';
  end if;
  update public.patient_documents set uploaded_at = now() where id = p_document returning * into d;
  return d;
end;
$$;

create or replace function public.delete_document(p_document uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.patient_documents;
begin
  select * into d from public.patient_documents where id = p_document and deleted_at is null for update;
  if not found or not private.can_at('documents.delete', d.branch_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to remove a document' using errcode = '23514';
  end if;
  -- Soft delete: the file is retained for the medico-legal retention period.
  update public.patient_documents set deleted_at = now(), deleted_by = auth.uid(), delete_reason = left(trim(p_reason), 300)
   where id = p_document;
end;
$$;

-- Called by the document-url Edge Function after it has authorized the read.
create or replace function public.log_document_access(p_document uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.patient_documents;
begin
  select * into d from public.patient_documents where id = p_document;
  if not found then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  insert into public.audit_events (actor_id, actor_type, action, event_type, entity_type, entity_id, branch_id, metadata)
  values (p_actor, 'user', 'access', 'patient_documents.accessed', 'patient_documents', d.id, d.branch_id,
          jsonb_build_object('patient_id', d.patient_id, 'category', d.category));
end;
$$;

create or replace function public.purge_abandoned_uploads(p_older_than interval default interval '24 hours')
returns table (storage_path text) language plpgsql security definer set search_path = '' as $$
begin
  return query
  delete from public.patient_documents d
  where d.uploaded_at is null and d.created_at < now() - p_older_than
  returning d.storage_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.patients enable row level security;
alter table public.patient_medical_profiles enable row level security;
alter table public.patient_consents enable row level security;
alter table public.appointments enable row level security;
alter table public.consultations enable row level security;
alter table public.consultation_amendments enable row level security;
alter table public.exam_field_definitions enable row level security;
alter table public.ayurvedic_examinations enable row level security;
alter table public.prescriptions enable row level security;
alter table public.prescription_items enable row level security;
alter table public.prescription_revisions enable row level security;
alter table public.prescription_templates enable row level security;
alter table public.investigations enable row level security;
alter table public.patient_documents enable row level security;
alter table public.follow_ups enable row level security;

-- Patients (inserts go through register_patient)
create policy patients_select on public.patients for select to authenticated
  using (private.can_see_patient(id));
create policy patients_update on public.patients for update to authenticated
  using (((select private.can('patients.edit_contact')) or (select private.can('patients.edit')) or (select private.can('patients.delete')))
         and private.can_see_patient(id))
  with check ((select private.can('patients.edit_contact')) or (select private.can('patients.edit')) or (select private.can('patients.delete')));

create policy medical_profiles_select on public.patient_medical_profiles for select to authenticated
  using (private.can_view_clinical('patients.view_history', patient_id));
create policy medical_profiles_insert on public.patient_medical_profiles for insert to authenticated
  with check ((select private.can('consultations.edit')));
create policy medical_profiles_update on public.patient_medical_profiles for update to authenticated
  using ((select private.can('consultations.edit'))) with check ((select private.can('consultations.edit')));

create policy patient_consents_select on public.patient_consents for select to authenticated
  using (private.can_see_patient(patient_id));
create policy patient_consents_insert on public.patient_consents for insert to authenticated
  with check ((select private.can('consents.manage')) and private.can_see_patient(patient_id)
              and recorded_by = auth.uid() and status = 'granted');
create policy patient_consents_update on public.patient_consents for update to authenticated
  using ((select private.can('consents.manage')) and private.can_see_patient(patient_id))
  with check ((select private.can('consents.manage')));

-- Appointments (status changes go through set_appointment_status)
create policy appointments_select on public.appointments for select to authenticated
  using (private.can_at('appointments.view', branch_id));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (private.can_at('appointments.create', branch_id) and status = 'scheduled' and private.can_see_patient(patient_id));
create policy appointments_update on public.appointments for update to authenticated
  using (private.can_at('appointments.reschedule', branch_id) and status in ('scheduled', 'checked_in'))
  with check (private.can_at('appointments.reschedule', branch_id));

-- Consultations: read with the clinical permission at the visit's branch;
-- write only by the doctor (doctor-only permissions).
create policy consultations_select on public.consultations for select to authenticated
  using (private.can_at('consultations.view', branch_id));
create policy consultations_insert on public.consultations for insert to authenticated
  with check ((select private.can('consultations.create')) and status = 'draft');
create policy consultations_update on public.consultations for update to authenticated
  using ((select private.can('consultations.edit')) and status = 'draft')
  with check ((select private.can('consultations.edit')));

create policy consultation_amendments_select on public.consultation_amendments for select to authenticated
  using (exists (select 1 from public.consultations c where c.id = consultation_id));
create policy consultation_amendments_insert on public.consultation_amendments for insert to authenticated
  with check ((select private.can('consultations.edit')) and author_id = auth.uid()
              and exists (select 1 from public.consultations c where c.id = consultation_id and c.status = 'finalized'));

create policy exam_fields_select on public.exam_field_definitions for select to authenticated
  using ((select private.is_active_user()));
create policy exam_fields_insert on public.exam_field_definitions for insert to authenticated
  with check ((select private.can('settings.organization')));
create policy exam_fields_update on public.exam_field_definitions for update to authenticated
  using ((select private.can('settings.organization'))) with check ((select private.can('settings.organization')));

create policy examinations_select on public.ayurvedic_examinations for select to authenticated
  using ((select private.can('examinations.view')) and exists (select 1 from public.consultations c where c.id = consultation_id));
create policy examinations_insert on public.ayurvedic_examinations for insert to authenticated
  with check ((select private.can('examinations.edit'))
              and exists (select 1 from public.consultations c where c.id = consultation_id and c.status = 'draft'));
create policy examinations_update on public.ayurvedic_examinations for update to authenticated
  using ((select private.can('examinations.edit'))) with check ((select private.can('examinations.edit')));

-- Prescriptions: drafts are the doctor's working copies.
create policy prescriptions_select on public.prescriptions for select to authenticated
  using (private.can_at('prescriptions.view', branch_id) and (status <> 'draft' or (select private.can('prescriptions.create'))));
create policy prescriptions_insert on public.prescriptions for insert to authenticated
  with check ((select private.can('prescriptions.create')) and status = 'draft' and prescription_no is null and revision_number = 1);
create policy prescriptions_update on public.prescriptions for update to authenticated
  using ((select private.can('prescriptions.create')))
  with check ((select private.can('prescriptions.create')) and status in ('draft', 'cancelled'));

create policy prescription_items_select on public.prescription_items for select to authenticated
  using (exists (select 1 from public.prescriptions p where p.id = prescription_id));
create policy prescription_items_insert on public.prescription_items for insert to authenticated
  with check ((select private.can('prescriptions.create'))
              and exists (select 1 from public.prescriptions p where p.id = prescription_id and p.status = 'draft'));
create policy prescription_items_update on public.prescription_items for update to authenticated
  using ((select private.can('prescriptions.create'))
         and exists (select 1 from public.prescriptions p where p.id = prescription_id and p.status = 'draft'));
create policy prescription_items_delete on public.prescription_items for delete to authenticated
  using ((select private.can('prescriptions.create'))
         and exists (select 1 from public.prescriptions p where p.id = prescription_id and p.status = 'draft'));

create policy prescription_revisions_select on public.prescription_revisions for select to authenticated
  using (exists (select 1 from public.prescriptions p where p.id = prescription_id));

create policy rx_templates_select on public.prescription_templates for select to authenticated
  using ((select private.can('prescriptions.create')));
create policy rx_templates_insert on public.prescription_templates for insert to authenticated
  with check ((select private.can('prescriptions.create')));
create policy rx_templates_update on public.prescription_templates for update to authenticated
  using ((select private.can('prescriptions.create'))) with check ((select private.can('prescriptions.create')));

create policy investigations_select on public.investigations for select to authenticated
  using (private.can_at('investigations.view', branch_id));
create policy investigations_insert on public.investigations for insert to authenticated
  with check ((select private.can('investigations.order')) and ordered_by = auth.uid());
create policy investigations_update on public.investigations for update to authenticated
  using ((select private.can('investigations.order')) or private.can_at('investigations.manage', branch_id))
  with check ((select private.can('investigations.order')) or private.can_at('investigations.manage', branch_id));

create policy patient_documents_select on public.patient_documents for select to authenticated
  using (deleted_at is null and private.can_at('documents.view', branch_id));
create policy patient_documents_insert on public.patient_documents for insert to authenticated
  with check (uploaded_by = auth.uid() and uploaded_at is null and deleted_at is null
              and private.can_at('investigations.upload', branch_id) and private.can_see_patient(patient_id));

create policy follow_ups_select on public.follow_ups for select to authenticated
  using (private.can_at('follow_ups.view', branch_id));
create policy follow_ups_insert on public.follow_ups for insert to authenticated
  with check (private.can_at('follow_ups.manage', branch_id) or (select private.can('consultations.edit')));
create policy follow_ups_update on public.follow_ups for update to authenticated
  using (private.can_at('follow_ups.manage', branch_id) or (select private.can('consultations.edit')))
  with check (private.can_at('follow_ups.manage', branch_id) or (select private.can('consultations.edit')));

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on public.patients, public.patient_medical_profiles, public.patient_consents, public.appointments,
  public.consultations, public.consultation_amendments, public.exam_field_definitions, public.ayurvedic_examinations,
  public.prescriptions, public.prescription_items, public.prescription_revisions, public.prescription_templates,
  public.investigations, public.patient_documents, public.follow_ups from anon, authenticated;

grant select on public.patients, public.patient_medical_profiles, public.patient_consents, public.appointments,
  public.consultations, public.consultation_amendments, public.exam_field_definitions, public.ayurvedic_examinations,
  public.prescriptions, public.prescription_items, public.prescription_revisions, public.prescription_templates,
  public.investigations, public.patient_documents, public.follow_ups to authenticated;
grant update (first_name, last_name, date_of_birth, approx_age_years, gender, phone, email, address_line, city, occupation,
  emergency_contact_name, emergency_contact_phone, preferred_locale, status) on public.patients to authenticated;
grant insert, update on public.patient_medical_profiles to authenticated;
grant insert, update on public.patient_consents to authenticated;
grant insert on public.appointments to authenticated;
grant update (starts_at, ends_at, branch_id, type, source, reason, notes) on public.appointments to authenticated;
grant insert, update on public.consultations, public.ayurvedic_examinations, public.prescriptions,
  public.prescription_templates, public.investigations, public.follow_ups to authenticated;
grant insert on public.consultation_amendments, public.patient_documents to authenticated;
grant insert, update on public.exam_field_definitions to authenticated;
grant insert, update, delete on public.prescription_items to authenticated;

revoke execute on all functions in schema private from public;
grant execute on function private.patient_in_my_branches(uuid), private.can_see_patient(uuid),
  private.can_view_clinical(text, uuid), private.log_patient_view(uuid) to authenticated;

revoke execute on function public.find_possible_duplicates(text, text, text, date, smallint),
  public.register_patient(jsonb, uuid, boolean, jsonb), public.view_patient(uuid), public.save_medical_profile(uuid, jsonb),
  public.set_appointment_status(uuid, public.appointment_status, text), public.save_consultation(uuid, jsonb, jsonb),
  public.finalize_consultation(uuid), public.save_prescription_draft(uuid, uuid, uuid, jsonb, jsonb),
  public.issue_prescription(uuid, boolean), public.revise_prescription(uuid, text),
  public.book_follow_up(uuid, timestamptz, timestamptz, uuid, text), public.confirm_document_upload(uuid),
  public.delete_document(uuid, text), public.log_document_access(uuid, uuid), public.purge_abandoned_uploads(interval)
  from public, anon, authenticated;
grant execute on function public.find_possible_duplicates(text, text, text, date, smallint),
  public.register_patient(jsonb, uuid, boolean, jsonb), public.view_patient(uuid), public.save_medical_profile(uuid, jsonb),
  public.set_appointment_status(uuid, public.appointment_status, text), public.save_consultation(uuid, jsonb, jsonb),
  public.finalize_consultation(uuid), public.save_prescription_draft(uuid, uuid, uuid, jsonb, jsonb),
  public.issue_prescription(uuid, boolean), public.revise_prescription(uuid, text),
  public.book_follow_up(uuid, timestamptz, timestamptz, uuid, text), public.confirm_document_upload(uuid),
  public.delete_document(uuid, text) to authenticated;
grant execute on function public.log_document_access(uuid, uuid), public.purge_abandoned_uploads(interval) to service_role;
