-- =============================================================================
-- Vaidyora — 0010 Clinical records: consultations, examinations, follow-ups,
--                 prescription revisions and templates, investigations
-- =============================================================================
-- Vaidyora records what clinicians observe and decide. It does not make,
-- suggest or validate diagnoses, and never proposes doses or treatments.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Consultations
-- -----------------------------------------------------------------------------
alter table public.consultations
  add column branch_id uuid,
  add column assessment text check (char_length(assessment) <= 3000),
  add column created_by uuid references auth.users (id) on delete set null default auth.uid(),
  add column updated_by uuid references auth.users (id) on delete set null,
  add constraint consultations_branch_fk foreign key (branch_id, clinic_id) references public.branches (id, clinic_id);
alter table public.consultations alter column visit_date drop default;
create index consultations_branch_idx on public.consultations (clinic_id, branch_id);

create or replace function private.consultations_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.visit_date := coalesce(new.visit_date, private.clinic_today(new.clinic_id));
  if new.branch_id is null and new.appointment_id is not null then
    select a.branch_id into new.branch_id from public.appointments a where a.id = new.appointment_id;
  end if;
  if new.branch_id is null then
    select m.default_branch_id into new.branch_id from public.clinic_members m where m.clinic_id = new.clinic_id and m.user_id = auth.uid();
  end if;
  return new;
end;
$$;
create trigger consultations_defaults before insert on public.consultations
  for each row execute function private.consultations_defaults();
create trigger consultations_updated_by before update on public.consultations
  for each row execute function private.set_updated_by();

drop policy consultations_select on public.consultations;
drop policy consultations_insert on public.consultations;
create policy consultations_select on public.consultations for select to authenticated
  using (private.can_read_clinical(clinic_id, patient_id) and private.in_branch_scope(clinic_id, branch_id));
create policy consultations_insert on public.consultations for insert to authenticated
  with check (
    doctor_id = auth.uid() and status = 'draft'
    and private.can_write_clinical(clinic_id, patient_id)
    and private.in_branch_scope(clinic_id, branch_id)
  );

-- -----------------------------------------------------------------------------
-- Ayurvedic examination: structured + narrative + clinic-configured fields
-- -----------------------------------------------------------------------------
alter table public.ayurvedic_examinations
  -- Clinician-entered dosha assessment (0–10 each). Not computed by software.
  add column vata_score smallint check (vata_score between 0 and 10),
  add column pitta_score smallint check (pitta_score between 0 and 10),
  add column kapha_score smallint check (kapha_score between 0 and 10),
  add column ama public.ama_level,
  add column nidra text check (char_length(nidra) <= 500),
  add column appetite text check (char_length(appetite) <= 500),
  add column digestion text check (char_length(digestion) <= 500),
  add column bowel_habits text check (char_length(bowel_habits) <= 500),
  add column dinacharya text check (char_length(dinacharya) <= 1000),
  add column lifestyle text check (char_length(lifestyle) <= 1000),
  add column general_examination text check (char_length(general_examination) <= 2000),
  add column family_history text check (char_length(family_history) <= 1000),
  add column custom_fields jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object' and pg_column_size(custom_fields) <= 16384),
  add column updated_by uuid references auth.users (id) on delete set null;
create trigger ayurvedic_examinations_updated_by before update on public.ayurvedic_examinations
  for each row execute function private.set_updated_by();

create table public.exam_field_definitions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_en text not null check (char_length(label_en) between 1 and 80),
  label_mr text check (char_length(label_mr) <= 80),
  field_type public.exam_field_type not null default 'text',
  -- For 'select': a JSON array of option strings.
  options jsonb check (options is null or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 30)),
  unit text check (char_length(unit) <= 20),
  position smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (clinic_id, key),
  check ((field_type = 'select') = (options is not null))
);
create trigger exam_field_definitions_updated_at before update on public.exam_field_definitions
  for each row execute function private.set_updated_at();
create trigger exam_field_definitions_updated_by before update on public.exam_field_definitions
  for each row execute function private.set_updated_by();
create trigger exam_field_definitions_clinic_immutable before update on public.exam_field_definitions
  for each row execute function private.prevent_clinic_change();

alter table public.exam_field_definitions enable row level security;
create policy exam_fields_select on public.exam_field_definitions for select to authenticated
  using (private.is_member(clinic_id));
create policy exam_fields_insert on public.exam_field_definitions for insert to authenticated
  with check (private.has_permission(clinic_id, 'settings.manage'));
create policy exam_fields_update on public.exam_field_definitions for update to authenticated
  using (private.has_permission(clinic_id, 'settings.manage'))
  with check (private.has_permission(clinic_id, 'settings.manage'));
revoke all on public.exam_field_definitions from anon;
grant select, insert, update on public.exam_field_definitions to authenticated;

create or replace function private.validate_exam_custom_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_def public.exam_field_definitions;
begin
  for v_key, v_value in select * from jsonb_each(new.custom_fields) loop
    select * into v_def from public.exam_field_definitions d
    where d.clinic_id = new.clinic_id and d.key = v_key and d.is_active;
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

-- -----------------------------------------------------------------------------
-- Transactional consultation save (now with the extended examination)
-- -----------------------------------------------------------------------------
create or replace function public.save_consultation(
  p_clinic uuid,
  p_id uuid,
  p_data jsonb,
  p_exam jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.consultations;
  e public.ayurvedic_examinations;
  v_id uuid;
begin
  r := jsonb_populate_record(null::public.consultations, p_data);
  e := jsonb_populate_record(null::public.ayurvedic_examinations, coalesce(p_exam, '{}'::jsonb));

  if p_id is null then
    insert into public.consultations (
      clinic_id, patient_id, doctor_id, appointment_id, chief_complaint, history_of_present_illness, past_history,
      pulse_bpm, bp_systolic, bp_diastolic, temperature_c, weight_kg, height_cm, spo2_percent,
      clinical_findings, assessment, diagnosis, ayurvedic_diagnosis, treatment_plan, pathya, apathya, follow_up_date
    ) values (
      p_clinic, r.patient_id, auth.uid(), r.appointment_id, r.chief_complaint, r.history_of_present_illness, r.past_history,
      r.pulse_bpm, r.bp_systolic, r.bp_diastolic, r.temperature_c, r.weight_kg, r.height_cm, r.spo2_percent,
      r.clinical_findings, r.assessment, r.diagnosis, r.ayurvedic_diagnosis, r.treatment_plan, r.pathya, r.apathya, r.follow_up_date
    ) returning id into v_id;

    if r.appointment_id is not null then
      perform public.set_appointment_status(r.appointment_id, 'in_consultation')
      from public.appointments a
      where a.id = r.appointment_id and a.status in ('scheduled', 'checked_in');
    end if;
  else
    update public.consultations set
      chief_complaint = r.chief_complaint,
      history_of_present_illness = r.history_of_present_illness,
      past_history = r.past_history,
      pulse_bpm = r.pulse_bpm, bp_systolic = r.bp_systolic, bp_diastolic = r.bp_diastolic,
      temperature_c = r.temperature_c, weight_kg = r.weight_kg, height_cm = r.height_cm, spo2_percent = r.spo2_percent,
      clinical_findings = r.clinical_findings, assessment = r.assessment, diagnosis = r.diagnosis,
      ayurvedic_diagnosis = r.ayurvedic_diagnosis, treatment_plan = r.treatment_plan,
      pathya = r.pathya, apathya = r.apathya, follow_up_date = r.follow_up_date
    where id = p_id and clinic_id = p_clinic
    returning id into v_id;
    if v_id is null then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
  end if;

  insert into public.ayurvedic_examinations (
    clinic_id, consultation_id, patient_id, prakriti, vikriti, agni, koshtha, bala,
    vata_score, pitta_score, kapha_score, ama,
    nadi, mutra, mala, jihva, shabda, sparsha, drik, akriti, sara, satva,
    nidra, appetite, digestion, bowel_habits, dinacharya, lifestyle, general_examination, family_history,
    custom_fields, notes
  )
  select p_clinic, v_id, c.patient_id, e.prakriti, coalesce(e.vikriti, '{}'), e.agni, e.koshtha, e.bala,
         e.vata_score, e.pitta_score, e.kapha_score, e.ama,
         e.nadi, e.mutra, e.mala, e.jihva, e.shabda, e.sparsha, e.drik, e.akriti, e.sara, e.satva,
         e.nidra, e.appetite, e.digestion, e.bowel_habits, e.dinacharya, e.lifestyle, e.general_examination, e.family_history,
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
    family_history = excluded.family_history, custom_fields = excluded.custom_fields, notes = excluded.notes;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Follow-ups
-- -----------------------------------------------------------------------------
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  patient_id uuid not null,
  doctor_id uuid not null,
  consultation_id uuid unique,
  appointment_id uuid unique,
  due_date date not null,
  -- Scheduling note only (visible to front-desk staff); clinical detail stays in the consultation.
  reason text check (char_length(reason) <= 300),
  status public.followup_status not null default 'pending',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'booked') <= (appointment_id is not null)),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (consultation_id, clinic_id) references public.consultations (id, clinic_id),
  foreign key (appointment_id, clinic_id) references public.appointments (id, clinic_id),
  foreign key (clinic_id, doctor_id) references public.clinic_members (clinic_id, user_id)
);
create index follow_ups_due_idx on public.follow_ups (clinic_id, status, due_date);
create index follow_ups_patient_idx on public.follow_ups (patient_id);
create trigger follow_ups_updated_at before update on public.follow_ups
  for each row execute function private.set_updated_at();
create trigger follow_ups_updated_by before update on public.follow_ups
  for each row execute function private.set_updated_by();
create trigger follow_ups_clinic_immutable before update on public.follow_ups
  for each row execute function private.prevent_clinic_change();

alter table public.follow_ups enable row level security;
create policy follow_ups_select on public.follow_ups for select to authenticated
  using (private.can_read_clinical(clinic_id, patient_id) or private.has_permission(clinic_id, 'appointments.manage'));
create policy follow_ups_insert on public.follow_ups for insert to authenticated
  with check (doctor_id = auth.uid() and private.can_write_clinical(clinic_id, patient_id));
create policy follow_ups_update on public.follow_ups for update to authenticated
  using (private.can_write_clinical(clinic_id, patient_id) or private.has_permission(clinic_id, 'appointments.manage'))
  with check (private.can_write_clinical(clinic_id, patient_id) or private.has_permission(clinic_id, 'appointments.manage'));
revoke all on public.follow_ups from anon;
grant select, insert, update on public.follow_ups to authenticated;

-- Book an appointment for a follow-up and link both rows atomically (RLS applies).
create or replace function public.book_follow_up(
  p_follow_up uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_branch uuid default null,
  p_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  f public.follow_ups;
  v_appt uuid;
begin
  select * into f from public.follow_ups where id = p_follow_up and status = 'pending' for update;
  if not found then
    raise exception 'Follow-up not found or already booked' using errcode = 'P0002';
  end if;
  insert into public.appointments (clinic_id, branch_id, patient_id, doctor_id, starts_at, ends_at, type, source, reason)
  values (f.clinic_id, p_branch, f.patient_id, f.doctor_id, p_starts_at, p_ends_at, 'follow_up', 'follow_up', coalesce(nullif(trim(p_reason), ''), f.reason))
  returning id into v_appt;
  update public.follow_ups set status = 'booked', appointment_id = v_appt where id = f.id;
  return v_appt;
end;
$$;

-- Finalizing a consultation also schedules its follow-up.
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

  if v_row.appointment_id is not null then
    update public.appointments set status = 'completed'
     where id = v_row.appointment_id and status in ('scheduled', 'checked_in', 'in_consultation');
    update public.follow_ups set status = 'completed'
     where appointment_id = v_row.appointment_id and status = 'booked';
  end if;

  if v_row.follow_up_date is not null then
    insert into public.follow_ups (clinic_id, patient_id, doctor_id, consultation_id, due_date, created_by)
    values (v_row.clinic_id, v_row.patient_id, v_row.doctor_id, v_row.id, v_row.follow_up_date, auth.uid())
    on conflict (consultation_id) do nothing;
  end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Prescriptions: language, instructions, follow-up, immutable revision history
-- -----------------------------------------------------------------------------
alter table public.prescriptions
  add column language text not null default 'en' check (language in ('en', 'mr')),
  add column patient_instructions text check (char_length(patient_instructions) <= 2000),
  add column follow_up_date date,
  add column revision_number integer not null default 1 check (revision_number >= 1),
  add column revision_reason text check (char_length(revision_reason) <= 500),
  add column updated_by uuid references auth.users (id) on delete set null;
create trigger prescriptions_updated_by before update on public.prescriptions
  for each row execute function private.set_updated_by();

alter table public.prescription_items
  add column route public.medicine_route not null default 'oral',
  add column quantity text check (char_length(quantity) <= 40),
  add column instructions_mr text check (char_length(instructions_mr) <= 500);
alter table public.prescription_items rename column instructions to instructions_en;

create table public.prescription_revisions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  prescription_id uuid not null,
  revision_number integer not null check (revision_number >= 1),
  -- Complete copy of the issued header and items, exactly as issued.
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  revision_reason text,
  issued_by uuid not null references auth.users (id),
  issued_at timestamptz not null default now(),
  unique (prescription_id, revision_number),
  foreign key (prescription_id, clinic_id) references public.prescriptions (id, clinic_id)
);

create or replace function private.immutable_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% records are immutable', tg_table_name using errcode = '42501';
end;
$$;
create trigger prescription_revisions_immutable before update or delete on public.prescription_revisions
  for each row execute function private.immutable_row();

-- Header changes outside the issue/revise RPCs are limited to draft content
-- and cancelling an issued prescription.
create or replace function private.lock_issued_prescription()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rpc boolean := coalesce(current_setting('vaidyora.rx_rpc', true), '') = 'on';
begin
  if v_rpc then
    return new;
  end if;
  if new.prescription_no is distinct from old.prescription_no
     or new.issued_at is distinct from old.issued_at
     or new.revision_number is distinct from old.revision_number
     or (new.status = 'issued' and old.status <> 'issued') then
    raise exception 'Prescriptions are issued and revised only through the issue and revise actions' using errcode = '42501';
  end if;
  if old.status <> 'draft' and not (old.status = 'issued' and new.status = 'cancelled') then
    raise exception 'Issued prescriptions can only be cancelled or revised' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop policy prescriptions_insert on public.prescriptions;
drop policy prescriptions_update on public.prescriptions;
create policy prescriptions_insert on public.prescriptions for insert to authenticated
  with check (
    doctor_id = auth.uid() and status = 'draft' and prescription_no is null and revision_number = 1
    and private.can_write_clinical(clinic_id, patient_id)
  );
create policy prescriptions_update on public.prescriptions for update to authenticated
  using (doctor_id = auth.uid() and private.has_permission(clinic_id, 'clinical.write'))
  with check (doctor_id = auth.uid() and status in ('draft', 'cancelled'));

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

  perform set_config('vaidyora.rx_rpc', 'on', true);
  update public.prescriptions
     set status = 'issued',
         issued_at = now(),
         prescription_no = coalesce(
           prescription_no,
           'RX-' || to_char(now() at time zone private.clinic_tz(clinic_id), 'YYYY') || '-'
             || lpad(private.next_number(clinic_id, 'prescription')::text, 6, '0'))
   where id = p_prescription
   returning * into v_row;
  perform set_config('vaidyora.rx_rpc', 'off', true);

  insert into public.prescription_revisions (clinic_id, prescription_id, revision_number, snapshot, revision_reason, issued_by, issued_at)
  values (
    v_row.clinic_id, v_row.id, v_row.revision_number,
    jsonb_build_object(
      'header', to_jsonb(v_row),
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.prescription_items i where i.prescription_id = v_row.id), '[]')
    ),
    v_row.revision_reason, auth.uid(), v_row.issued_at
  );
  return v_row;
end;
$$;

-- Re-open an issued prescription as the next revision. The issued revision
-- stays in prescription_revisions unchanged; the prescription number is kept.
create or replace function public.revise_prescription(p_prescription uuid, p_reason text)
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

drop function public.save_prescription_draft(uuid, uuid, uuid, uuid, text, jsonb);
create or replace function public.save_prescription_draft(
  p_clinic uuid,
  p_id uuid,
  p_patient uuid,
  p_consultation uuid,
  p_header jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  h public.prescriptions;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 50 then
    raise exception 'Too many line items' using errcode = '23514';
  end if;
  h := jsonb_populate_record(null::public.prescriptions, coalesce(p_header, '{}'::jsonb));

  if p_id is null then
    insert into public.prescriptions (clinic_id, patient_id, doctor_id, consultation_id, notes, language, patient_instructions, follow_up_date)
    values (p_clinic, p_patient, auth.uid(), p_consultation, nullif(trim(h.notes), ''), coalesce(h.language, 'en'),
            nullif(trim(h.patient_instructions), ''), h.follow_up_date)
    returning id into v_id;
  else
    update public.prescriptions
       set notes = nullif(trim(h.notes), ''), language = coalesce(h.language, 'en'),
           patient_instructions = nullif(trim(h.patient_instructions), ''), follow_up_date = h.follow_up_date
     where id = p_id and clinic_id = p_clinic and status = 'draft'
     returning id into v_id;
    if v_id is null then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    delete from public.prescription_items where prescription_id = v_id;
  end if;

  insert into public.prescription_items (
    clinic_id, prescription_id, position, medicine_name, form, route, dose, quantity, frequency, timing,
    anupana, duration_days, instructions_en, instructions_mr
  )
  select p_clinic, v_id, (i.ordinality - 1)::smallint, (i.r).medicine_name, coalesce((i.r).form, 'other'),
         coalesce((i.r).route, 'oral'), (i.r).dose, (i.r).quantity, (i.r).frequency, coalesce((i.r).timing, 'after_food'),
         (i.r).anupana, (i.r).duration_days, (i.r).instructions_en, (i.r).instructions_mr
  from (
    select jsonb_populate_record(null::public.prescription_items, x.value) as r, x.ordinality
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(value, ordinality)
  ) i;

  return v_id;
end;
$$;

alter table public.prescription_revisions enable row level security;
create policy prescription_revisions_select on public.prescription_revisions for select to authenticated
  using (exists (select 1 from public.prescriptions p where p.id = prescription_id));
revoke all on public.prescription_revisions from anon, authenticated;
grant select on public.prescription_revisions to authenticated;

-- Clinician-authored templates. The application never generates their content.
create table public.prescription_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 500),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  patient_instructions text check (char_length(patient_instructions) <= 2000),
  is_shared boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, owner_id, name),
  foreign key (clinic_id, owner_id) references public.clinic_members (clinic_id, user_id)
);
create trigger prescription_templates_updated_at before update on public.prescription_templates
  for each row execute function private.set_updated_at();
create trigger prescription_templates_clinic_immutable before update on public.prescription_templates
  for each row execute function private.prevent_clinic_change();

create or replace function private.validate_template_items()
returns trigger
language plpgsql
set search_path = ''
as $$
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

alter table public.prescription_templates enable row level security;
create policy rx_templates_select on public.prescription_templates for select to authenticated
  using (private.has_permission(clinic_id, 'clinical.write') and (owner_id = auth.uid() or is_shared));
create policy rx_templates_insert on public.prescription_templates for insert to authenticated
  with check (private.has_permission(clinic_id, 'clinical.write') and owner_id = auth.uid());
create policy rx_templates_update on public.prescription_templates for update to authenticated
  using (owner_id = auth.uid() and private.has_permission(clinic_id, 'clinical.write'))
  with check (owner_id = auth.uid());
revoke all on public.prescription_templates from anon;
grant select, insert, update on public.prescription_templates to authenticated;

-- -----------------------------------------------------------------------------
-- Investigations: notes; result files move to patient_documents (0011)
-- -----------------------------------------------------------------------------
alter table public.investigations
  add column notes text check (char_length(notes) <= 2000),
  add column updated_by uuid references auth.users (id) on delete set null,
  drop column result_file_path;
create trigger investigations_updated_by before update on public.investigations
  for each row execute function private.set_updated_by();

revoke execute on function public.book_follow_up(uuid, timestamptz, timestamptz, uuid, text) from public, anon;
revoke execute on function public.revise_prescription(uuid, text) from public, anon;
revoke execute on function public.save_prescription_draft(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.book_follow_up(uuid, timestamptz, timestamptz, uuid, text) to authenticated;
grant execute on function public.revise_prescription(uuid, text) to authenticated;
grant execute on function public.save_prescription_draft(uuid, uuid, uuid, uuid, jsonb, jsonb) to authenticated;
