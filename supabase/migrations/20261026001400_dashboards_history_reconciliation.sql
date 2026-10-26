-- =============================================================================
-- Vaidyora — 0014 Dashboards, patient history form, amendments, reconciliation,
--                 access reviews, clinic preferences
-- =============================================================================

insert into public.permissions (key, description) values
  ('payments.reconcile', 'Mark payments as reconciled with bank/UPI settlements')
on conflict (key) do update set description = excluded.description;

-- Admins manage prescriptions (search, view issued versions, print) but never
-- see drafts or write clinical content. Remove this row to opt a clinic out.
insert into public.role_permissions (role, permission) values
  ('admin', 'payments.reconcile'),
  ('admin', 'prescriptions.read_all'),
  ('accountant', 'payments.reconcile')
on conflict do nothing;

drop policy prescriptions_select on public.prescriptions;
create policy prescriptions_select on public.prescriptions for select to authenticated
  using (
    private.can_read_clinical(clinic_id, patient_id)
    or (private.has_permission(clinic_id, 'prescriptions.read_all') and status <> 'draft')
  );

-- -----------------------------------------------------------------------------
-- Patient history form (रुग्णपत्रिका) fields
-- -----------------------------------------------------------------------------
alter table public.consultations
  -- वेदना विशेष: site, character, onset, aggravating/relieving factors
  add column pain_details text check (char_length(pain_details) <= 2000),
  -- Private clinical notes of the treating doctor (not printed)
  add column doctor_notes text check (char_length(doctor_notes) <= 5000);

alter table public.ayurvedic_examinations
  add column family_history_maternal text check (char_length(family_history_maternal) <= 1000), -- मातृज
  add column family_history_paternal text check (char_length(family_history_paternal) <= 1000), -- पितृज
  add column family_history_self text check (char_length(family_history_self) <= 1000),         -- स्वकुल
  add column menstrual_history text check (char_length(menstrual_history) <= 1000);             -- रजोइतिहास

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
      clinic_id, patient_id, doctor_id, appointment_id, chief_complaint, pain_details, history_of_present_illness, past_history,
      pulse_bpm, bp_systolic, bp_diastolic, temperature_c, weight_kg, height_cm, spo2_percent,
      clinical_findings, assessment, diagnosis, ayurvedic_diagnosis, treatment_plan, pathya, apathya, follow_up_date, doctor_notes
    ) values (
      p_clinic, r.patient_id, auth.uid(), r.appointment_id, r.chief_complaint, r.pain_details, r.history_of_present_illness, r.past_history,
      r.pulse_bpm, r.bp_systolic, r.bp_diastolic, r.temperature_c, r.weight_kg, r.height_cm, r.spo2_percent,
      r.clinical_findings, r.assessment, r.diagnosis, r.ayurvedic_diagnosis, r.treatment_plan, r.pathya, r.apathya, r.follow_up_date, r.doctor_notes
    ) returning id into v_id;

    if r.appointment_id is not null then
      perform public.set_appointment_status(r.appointment_id, 'in_consultation')
      from public.appointments a
      where a.id = r.appointment_id and a.status in ('scheduled', 'checked_in');
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
    family_history_maternal, family_history_paternal, family_history_self, menstrual_history,
    custom_fields, notes
  )
  select p_clinic, v_id, c.patient_id, e.prakriti, coalesce(e.vikriti, '{}'), e.agni, e.koshtha, e.bala,
         e.vata_score, e.pitta_score, e.kapha_score, e.ama,
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

-- -----------------------------------------------------------------------------
-- Amendments to finalized consultations (append-only addenda)
-- -----------------------------------------------------------------------------
-- A finalized record is never edited. Corrections are added as dated,
-- attributed amendments; the record is then shown as "Amended".
create table public.consultation_amendments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  consultation_id uuid not null,
  author_id uuid not null default auth.uid() references auth.users (id),
  reason text not null check (char_length(reason) between 1 and 300),
  content text not null check (char_length(content) between 1 and 5000),
  created_at timestamptz not null default now(),
  foreign key (consultation_id, clinic_id) references public.consultations (id, clinic_id)
);
create index consultation_amendments_consultation_idx on public.consultation_amendments (consultation_id, created_at);
create trigger consultation_amendments_immutable before update or delete on public.consultation_amendments
  for each row execute function private.immutable_row();
create trigger consultation_amendments_audit after insert on public.consultation_amendments
  for each row execute function private.audit_row();

alter table public.consultation_amendments enable row level security;
create policy consultation_amendments_select on public.consultation_amendments for select to authenticated
  using (exists (select 1 from public.consultations c where c.id = consultation_id));
create policy consultation_amendments_insert on public.consultation_amendments for insert to authenticated
  with check (
    author_id = auth.uid()
    and private.has_permission(clinic_id, 'clinical.write')
    and exists (
      select 1 from public.consultations c
      where c.id = consultation_id and c.status = 'finalized' and c.doctor_id = auth.uid()
    )
  );
revoke all on public.consultation_amendments from anon, authenticated;
grant select, insert on public.consultation_amendments to authenticated;

-- -----------------------------------------------------------------------------
-- Prescriptions: issuing requires the clinician's explicit confirmation
-- -----------------------------------------------------------------------------
drop function public.issue_prescription(uuid);
create function public.issue_prescription(p_prescription uuid, p_clinician_confirmed boolean)
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
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.prescription_items i where i.prescription_id = v_row.id), '[]'),
      'clinician_confirmed', true
    ),
    v_row.revision_reason, auth.uid(), v_row.issued_at
  );
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Payment reconciliation
-- -----------------------------------------------------------------------------
alter table public.payments
  add column settlement_reference text check (char_length(settlement_reference) <= 80),
  add column reconciliation_note text check (char_length(reconciliation_note) <= 300),
  add column reconciled_at timestamptz,
  add column reconciled_by uuid references auth.users (id) on delete set null,
  add constraint payments_reconciled_by_check check ((reconciled_at is null) = (reconciled_by is null));
create index payments_unreconciled_idx on public.payments (clinic_id, paid_at) where reconciled_at is null;

-- Payment amounts and references are fixed; only reconciliation fields change.
create or replace function private.payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['settlement_reference', 'reconciliation_note', 'reconciled_at', 'reconciled_by'])
     is distinct from (to_jsonb(old) - array['settlement_reference', 'reconciliation_note', 'reconciled_at', 'reconciled_by']) then
    raise exception 'Payments cannot be changed; record a refund instead' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger payments_guard before update on public.payments
  for each row execute function private.payments_guard();

create or replace function public.reconcile_payment(
  p_payment uuid,
  p_reconciled boolean,
  p_settlement_reference text default null,
  p_note text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.payments;
begin
  select * into v_row from public.payments where id = p_payment for update;
  if not found or not private.has_permission(v_row.clinic_id, 'payments.reconcile') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.payments
     set reconciled_at = case when p_reconciled then now() end,
         reconciled_by = case when p_reconciled then auth.uid() end,
         settlement_reference = case when p_reconciled then nullif(left(trim(p_settlement_reference), 80), '') end,
         reconciliation_note = nullif(left(trim(p_note), 300), '')
   where id = p_payment
   returning * into v_row;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Access reviews (periodic review of who can access the clinic)
-- -----------------------------------------------------------------------------
create table public.access_reviews (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references auth.users (id),
  member_count integer not null check (member_count >= 0),
  changes_made boolean not null default false,
  notes text check (char_length(notes) <= 1000),
  reviewed_at timestamptz not null default now()
);
create index access_reviews_clinic_idx on public.access_reviews (clinic_id, reviewed_at desc);
create trigger access_reviews_immutable before update or delete on public.access_reviews
  for each row execute function private.immutable_row();
create trigger access_reviews_audit after insert on public.access_reviews
  for each row execute function private.audit_row();

alter table public.access_reviews enable row level security;
create policy access_reviews_select on public.access_reviews for select to authenticated
  using (private.has_permission(clinic_id, 'users.manage') or private.has_permission(clinic_id, 'audit.read'));
create policy access_reviews_insert on public.access_reviews for insert to authenticated
  with check (reviewer_id = auth.uid() and private.has_permission(clinic_id, 'users.manage'));
revoke all on public.access_reviews from anon, authenticated;
grant select, insert on public.access_reviews to authenticated;

-- Last recorded activity per member, for access reviews (no record contents).
create or replace function public.member_last_activity(p_clinic uuid)
returns table (user_id uuid, last_activity_at timestamptz, last_session_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_clinic, 'users.manage') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select m.user_id,
         (select max(e.created_at) from public.audit_events e where e.clinic_id = p_clinic and e.actor_id = m.user_id),
         (select max(e.created_at) from public.audit_events e where e.clinic_id = p_clinic and e.actor_id = m.user_id and e.action = 'security')
  from public.clinic_members m
  where m.clinic_id = p_clinic;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clinic preferences (clinics.settings) — validated shape
-- -----------------------------------------------------------------------------
-- {
--   "bilingual_labels": bool,                  -- show Marathi + English labels
--   "default_appointment_minutes": 5..240,
--   "prescription_language": "patient"|"en"|"mr",
--   "consultation_sections": { "<section>": bool },
--   "demo": bool                               -- set only by trusted seed/platform code
-- }
create or replace function private.validate_clinic_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s jsonb := new.settings;
  k text;
begin
  for k in select jsonb_object_keys(s) loop
    if k not in ('bilingual_labels', 'default_appointment_minutes', 'prescription_language', 'consultation_sections', 'demo') then
      raise exception 'Unknown clinic setting: %', k using errcode = '23514';
    end if;
  end loop;
  if (s ? 'bilingual_labels' and jsonb_typeof(s -> 'bilingual_labels') <> 'boolean')
     or (s ? 'demo' and jsonb_typeof(s -> 'demo') <> 'boolean')
     or (s ? 'default_appointment_minutes' and (jsonb_typeof(s -> 'default_appointment_minutes') <> 'number'
         or (s ->> 'default_appointment_minutes')::numeric not between 5 and 240))
     or (s ? 'prescription_language' and coalesce(s ->> 'prescription_language', '') not in ('patient', 'en', 'mr'))
     or (s ? 'consultation_sections' and (jsonb_typeof(s -> 'consultation_sections') <> 'object'
         or exists (select 1 from jsonb_each(s -> 'consultation_sections') x where jsonb_typeof(x.value) <> 'boolean'))) then
    raise exception 'Invalid clinic setting value' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (s -> 'demo') is distinct from (old.settings -> 'demo')
     and current_user not in ('postgres', 'service_role')
     and coalesce(current_setting('vaidyora.platform_op', true), '') <> 'on' then
    raise exception 'The demo flag is managed by the platform' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clinics_validate_settings before insert or update of settings on public.clinics
  for each row execute function private.validate_clinic_settings();

-- -----------------------------------------------------------------------------
-- Admin overview, trends and branch comparison
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER aggregate functions: they return COUNTS and SUMS only (no
-- record contents), so admins can monitor clinical activity without being able
-- to read consultation notes. Every figure respects the caller's branch scope.
create or replace function public.clinic_overview(p_clinic uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := private.clinic_tz(p_clinic);
  v_today date := private.clinic_today(p_clinic);
begin
  if not private.has_permission(p_clinic, 'reports.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a date range of up to one year' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'patients_total', (select count(*) from public.patients p where p.clinic_id = p_clinic and p.status = 'active'),
    'patients_new', (select count(*) from public.patients p where p.clinic_id = p_clinic and p.registered_on between p_from and p_to),
    'appointments_today', (select count(*) from public.appointments a where a.clinic_id = p_clinic
        and (a.starts_at at time zone v_tz)::date = v_today and a.status not in ('cancelled', 'no_show')
        and private.in_branch_scope(p_clinic, a.branch_id)),
    'appointments_in_range', (select count(*) from public.appointments a where a.clinic_id = p_clinic
        and (a.starts_at at time zone v_tz)::date between p_from and p_to and private.in_branch_scope(p_clinic, a.branch_id)),
    'appointments_no_show', (select count(*) from public.appointments a where a.clinic_id = p_clinic and a.status = 'no_show'
        and (a.starts_at at time zone v_tz)::date between p_from and p_to and private.in_branch_scope(p_clinic, a.branch_id)),
    'consultations_completed', (select count(*) from public.consultations c where c.clinic_id = p_clinic and c.status = 'finalized'
        and c.visit_date between p_from and p_to and private.in_branch_scope(p_clinic, c.branch_id)),
    'consultations_open', (select count(*) from public.consultations c where c.clinic_id = p_clinic and c.status = 'draft'
        and private.in_branch_scope(p_clinic, c.branch_id)),
    'follow_ups_pending', (select count(*) from public.follow_ups f where f.clinic_id = p_clinic and f.status = 'pending'),
    'follow_ups_overdue', (select count(*) from public.follow_ups f where f.clinic_id = p_clinic and f.status = 'pending' and f.due_date < v_today),
    'collected_paise', (select coalesce(sum(pm.amount_paise), 0) from public.payments pm join public.invoices i on i.id = pm.invoice_id
        where pm.clinic_id = p_clinic and (pm.paid_at at time zone v_tz)::date between p_from and p_to
          and private.in_branch_scope(p_clinic, i.branch_id)),
    'refunded_paise', (select coalesce(sum(r.amount_paise), 0) from public.refunds r join public.invoices i on i.id = r.invoice_id
        where r.clinic_id = p_clinic and (r.refunded_at at time zone v_tz)::date between p_from and p_to
          and private.in_branch_scope(p_clinic, i.branch_id)),
    'outstanding_paise', (select coalesce(sum(i.total_paise - i.amount_paid_paise), 0) from public.invoices i
        where i.clinic_id = p_clinic and i.status in ('issued', 'partially_paid') and private.in_branch_scope(p_clinic, i.branch_id)),
    'unreconciled_payments', (select count(*) from public.payments pm join public.invoices i on i.id = pm.invoice_id
        where pm.clinic_id = p_clinic and pm.reconciled_at is null and private.in_branch_scope(p_clinic, i.branch_id))
  );
end;
$$;

create or replace function public.clinic_trends(p_clinic uuid, p_from date, p_to date, p_bucket text default 'day')
returns table (
  period date, new_patients bigint, appointments bigint, appointments_completed bigint,
  consultations_completed bigint, collected_paise bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := private.clinic_tz(p_clinic);
begin
  if not private.has_permission(p_clinic, 'reports.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'Unknown period' using errcode = '22023';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a date range of up to one year' using errcode = '22023';
  end if;
  return query
  with periods as (
    select distinct date_trunc(p_bucket, d)::date as period
    from generate_series(p_from, p_to, interval '1 day') d
  )
  select pr.period,
    (select count(*) from public.patients p where p.clinic_id = p_clinic
       and p.registered_on between p_from and p_to and date_trunc(p_bucket, p.registered_on)::date = pr.period),
    (select count(*) from public.appointments a where a.clinic_id = p_clinic and private.in_branch_scope(p_clinic, a.branch_id)
       and (a.starts_at at time zone v_tz)::date between p_from and p_to
       and date_trunc(p_bucket, (a.starts_at at time zone v_tz)::date)::date = pr.period),
    (select count(*) from public.appointments a where a.clinic_id = p_clinic and a.status = 'completed' and private.in_branch_scope(p_clinic, a.branch_id)
       and (a.starts_at at time zone v_tz)::date between p_from and p_to
       and date_trunc(p_bucket, (a.starts_at at time zone v_tz)::date)::date = pr.period),
    (select count(*) from public.consultations c where c.clinic_id = p_clinic and c.status = 'finalized' and private.in_branch_scope(p_clinic, c.branch_id)
       and c.visit_date between p_from and p_to and date_trunc(p_bucket, c.visit_date)::date = pr.period),
    (select coalesce(sum(pm.amount_paise), 0) from public.payments pm join public.invoices i on i.id = pm.invoice_id
       where pm.clinic_id = p_clinic and private.in_branch_scope(p_clinic, i.branch_id)
         and (pm.paid_at at time zone v_tz)::date between p_from and p_to
         and date_trunc(p_bucket, (pm.paid_at at time zone v_tz)::date)::date = pr.period)::bigint
  from periods pr
  order by 1;
end;
$$;

create or replace function public.branch_metrics(p_clinic uuid, p_from date, p_to date)
returns table (
  branch_id uuid, branch_name text, appointments bigint, appointments_completed bigint, no_shows bigint,
  consultations_completed bigint, invoiced_paise bigint, collected_paise bigint, outstanding_paise bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := private.clinic_tz(p_clinic);
begin
  if not private.has_permission(p_clinic, 'reports.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select b.id, b.name,
    (select count(*) from public.appointments a where a.branch_id = b.id and (a.starts_at at time zone v_tz)::date between p_from and p_to),
    (select count(*) from public.appointments a where a.branch_id = b.id and a.status = 'completed' and (a.starts_at at time zone v_tz)::date between p_from and p_to),
    (select count(*) from public.appointments a where a.branch_id = b.id and a.status = 'no_show' and (a.starts_at at time zone v_tz)::date between p_from and p_to),
    (select count(*) from public.consultations c where c.branch_id = b.id and c.status = 'finalized' and c.visit_date between p_from and p_to),
    (select coalesce(sum(i.total_paise), 0) from public.invoices i where i.branch_id = b.id and i.status <> 'void' and i.issue_date between p_from and p_to)::bigint,
    (select coalesce(sum(pm.amount_paise), 0) from public.payments pm join public.invoices i on i.id = pm.invoice_id
       where i.branch_id = b.id and (pm.paid_at at time zone v_tz)::date between p_from and p_to)::bigint,
    (select coalesce(sum(i.total_paise - i.amount_paid_paise), 0) from public.invoices i where i.branch_id = b.id and i.status in ('issued', 'partially_paid'))::bigint
  from public.branches b
  where b.clinic_id = p_clinic and private.in_branch_scope(p_clinic, b.id)
  order by b.is_primary desc, b.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Doctor workspace
-- -----------------------------------------------------------------------------
-- Patients the caller opened recently (from their own view events), limited to
-- patients they can still access. Never exposes other users' activity.
create or replace function public.my_recent_patients(p_clinic uuid, p_limit integer default 8)
returns table (patient_id uuid, first_name text, last_name text, patient_code text, last_viewed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_clinic) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select p.id, p.first_name, p.last_name, p.patient_code, v.last_viewed_at
  from (
    select e.entity_id, max(e.created_at) as last_viewed_at
    from public.audit_events e
    where e.clinic_id = p_clinic and e.actor_id = auth.uid() and e.event_type = 'patients.viewed'
      and e.created_at > now() - interval '30 days'
    group by e.entity_id
  ) v
  join public.patients p on p.id = v.entity_id
  where private.can_read_patient(p_clinic, p.id)
  order by v.last_viewed_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
end;
$$;

-- Doctor counts are SECURITY INVOKER: they only ever count what RLS lets the
-- caller see (their own schedule and patients).
create or replace function public.doctor_overview(p_clinic uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (select private.clinic_tz(p_clinic) as tz, private.clinic_today(p_clinic) as today)
  select jsonb_build_object(
    'appointments_today', (select count(*) from public.appointments a, b where a.clinic_id = p_clinic and a.doctor_id = auth.uid()
        and (a.starts_at at time zone b.tz)::date = b.today and a.status not in ('cancelled', 'no_show')),
    'waiting', (select count(*) from public.appointments a, b where a.clinic_id = p_clinic and a.doctor_id = auth.uid()
        and (a.starts_at at time zone b.tz)::date = b.today and a.status = 'checked_in'),
    'in_progress', (select count(*) from public.consultations c where c.clinic_id = p_clinic and c.doctor_id = auth.uid() and c.status = 'draft'),
    'completed_today', (select count(*) from public.consultations c, b where c.clinic_id = p_clinic and c.doctor_id = auth.uid()
        and c.status = 'finalized' and (c.finalized_at at time zone b.tz)::date = b.today),
    'completed_this_month', (select count(*) from public.consultations c, b where c.clinic_id = p_clinic and c.doctor_id = auth.uid()
        and c.status = 'finalized' and c.visit_date >= date_trunc('month', b.today)::date),
    'follow_ups_due', (select count(*) from public.follow_ups f, b where f.clinic_id = p_clinic and f.doctor_id = auth.uid()
        and f.status = 'pending' and f.due_date <= b.today + 7)
  );
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.issue_prescription(uuid, boolean) from public, anon;
revoke execute on function public.reconcile_payment(uuid, boolean, text, text) from public, anon;
revoke execute on function public.member_last_activity(uuid) from public, anon;
revoke execute on function public.clinic_overview(uuid, date, date) from public, anon;
revoke execute on function public.clinic_trends(uuid, date, date, text) from public, anon;
revoke execute on function public.branch_metrics(uuid, date, date) from public, anon;
revoke execute on function public.my_recent_patients(uuid, integer) from public, anon;
revoke execute on function public.doctor_overview(uuid) from public, anon;
grant execute on function public.issue_prescription(uuid, boolean) to authenticated;
grant execute on function public.reconcile_payment(uuid, boolean, text, text) to authenticated;
grant execute on function public.member_last_activity(uuid) to authenticated;
grant execute on function public.clinic_overview(uuid, date, date) to authenticated;
grant execute on function public.clinic_trends(uuid, date, date, text) to authenticated;
grant execute on function public.branch_metrics(uuid, date, date) to authenticated;
grant execute on function public.my_recent_patients(uuid, integer) to authenticated;
grant execute on function public.doctor_overview(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Branch attribution: a member without a default branch works in the primary
-- branch, so every appointment, consultation and invoice belongs to a branch.
-- -----------------------------------------------------------------------------
create or replace function private.default_branch(p_clinic uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.default_branch_id from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = auth.uid()),
    (select b.id from public.branches b where b.clinic_id = p_clinic and b.is_primary)
  );
$$;

create or replace function private.appointment_branch_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.branch_id := coalesce(new.branch_id, private.default_branch(new.clinic_id));
  return new;
end;
$$;

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
  new.branch_id := coalesce(new.branch_id, private.default_branch(new.clinic_id));
  return new;
end;
$$;

create or replace function private.invoices_branch_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null and new.appointment_id is not null then
    select a.branch_id into new.branch_id from public.appointments a where a.id = new.appointment_id;
  end if;
  new.branch_id := coalesce(new.branch_id, private.default_branch(new.clinic_id));
  return new;
end;
$$;
create trigger invoices_branch_default before insert on public.invoices
  for each row execute function private.invoices_branch_default();

-- create_invoice checks branch scope against the same default the trigger applies.
create or replace function public.create_invoice(
  p_clinic uuid,
  p_patient uuid,
  p_items jsonb,
  p_discount_paise bigint default 0,
  p_notes text default null,
  p_appointment uuid default null,
  p_branch uuid default null
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_item jsonb;
  v_pos smallint := 0;
  v_qty numeric;
  v_price bigint;
  v_rate numeric;
  v_line bigint;
  v_tax bigint;
  v_subtotal bigint := 0;
  v_tax_total bigint := 0;
  v_prefix text;
  v_branch uuid := p_branch;
begin
  if not private.has_permission(p_clinic, 'billing.create') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  v_branch := coalesce(v_branch, private.default_branch(p_clinic));
  if not private.in_branch_scope(p_clinic, v_branch) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'An invoice needs at least one line item' using errcode = '23514';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Too many line items' using errcode = '23514';
  end if;
  if coalesce(p_discount_paise, 0) < 0 then
    raise exception 'Discount cannot be negative' using errcode = '23514';
  end if;

  select invoice_prefix into v_prefix from public.clinics where id = p_clinic;

  insert into public.invoices (
    clinic_id, branch_id, patient_id, appointment_id, invoice_no, issue_date,
    subtotal_paise, tax_paise, discount_paise, total_paise, notes, created_by
  ) values (
    p_clinic, v_branch, p_patient, p_appointment,
    v_prefix || '-' || to_char(now() at time zone private.clinic_tz(p_clinic), 'YYYY') || '-'
      || lpad(private.next_number(p_clinic, 'invoice')::text, 6, '0'),
    private.clinic_today(p_clinic),
    0, 0, 0, 0, nullif(trim(p_notes), ''), auth.uid()
  ) returning * into v_invoice;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price_paise')::bigint;
    v_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    if v_qty is null or v_price is null then
      raise exception 'Each line item needs a quantity and unit price' using errcode = '23514';
    end if;
    v_line := round(v_qty * v_price);
    v_tax := round(v_line * v_rate / 100);

    insert into public.invoice_items (
      clinic_id, invoice_id, position, item_type, description, quantity,
      unit_price_paise, tax_rate, line_total_paise, tax_paise
    ) values (
      p_clinic, v_invoice.id, v_pos,
      coalesce((v_item ->> 'item_type')::public.invoice_item_type, 'other'),
      trim(v_item ->> 'description'), v_qty, v_price, v_rate, v_line, v_tax
    );
    v_pos := v_pos + 1;
    v_subtotal := v_subtotal + v_line;
    v_tax_total := v_tax_total + v_tax;
  end loop;

  if coalesce(p_discount_paise, 0) > v_subtotal + v_tax_total then
    raise exception 'Discount cannot exceed the invoice amount' using errcode = '23514';
  end if;

  update public.invoices
     set subtotal_paise = v_subtotal,
         tax_paise = v_tax_total,
         discount_paise = coalesce(p_discount_paise, 0),
         total_paise = v_subtotal + v_tax_total - coalesce(p_discount_paise, 0),
         status = case when v_subtotal + v_tax_total - coalesce(p_discount_paise, 0) = 0
                       then 'paid'::public.invoice_status else 'issued'::public.invoice_status end
   where id = v_invoice.id
   returning * into v_invoice;

  return v_invoice;
end;
$$;


revoke execute on function private.default_branch(uuid) from public;
