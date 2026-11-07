-- Consultation fee.
--
-- The doctor records the fee on the consultation (the visit). Finalizing the
-- consultation raises the matching invoice in Billing, so the front desk only
-- has to collect the payment. One visit is billed once, however many
-- prescriptions it has. A prescription written without a consultation carries
-- its own fee, billed when it is issued.
--
-- Raising these invoices is part of the doctor's finalize/issue actions, so it
-- does not need the caller's billing permissions (the doctor's account does not
-- handle money). It only ever touches the invoice linked to that record, and
-- never one with a payment recorded.

alter table public.consultations
  add column consultation_fee_paise bigint check (consultation_fee_paise >= 0 and consultation_fee_paise <= 10000000),
  add column invoice_id uuid references public.invoices (id) on delete set null;
create index consultations_invoice_idx on public.consultations (invoice_id) where invoice_id is not null;

alter table public.prescriptions
  add column consultation_fee_paise bigint check (consultation_fee_paise >= 0 and consultation_fee_paise <= 10000000),
  add column invoice_id uuid references public.invoices (id) on delete set null,
  add constraint prescriptions_fee_standalone check (consultation_fee_paise is null or consultation_id is null);
create index prescriptions_invoice_idx on public.prescriptions (invoice_id) where invoice_id is not null;

-- ---------------------------------------------------------------- shared billing step

-- Keep, replace or raise the fee invoice linked to a clinical record.
create or replace function private.sync_fee_invoice(p_current uuid, p_fee bigint, p_patient uuid, p_branch uuid,
  p_appointment uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_fee bigint := coalesce(p_fee, 0);
  v_current public.invoices;
  v_invoice public.invoices;
begin
  if p_current is not null then
    select * into v_current from public.invoices where id = p_current for update;
  end if;

  -- The existing invoice still matches, or money has been taken on it: keep it.
  if v_current.id is not null and v_current.status <> 'void'
     and (v_current.total_paise = v_fee or v_current.amount_paid_paise > 0) then
    return v_current.id;
  end if;

  -- Replace an unpaid invoice whose amount no longer matches.
  if v_current.id is not null and v_current.status <> 'void' then
    update public.invoices set status = 'void', void_reason = 'Replaced: consultation fee changed (' || p_note || ')'
     where id = v_current.id;
  end if;

  if v_fee = 0 then
    return null;
  end if;

  insert into public.invoices (branch_id, patient_id, appointment_id, invoice_no, issue_date,
    subtotal_paise, tax_paise, discount_paise, total_paise, notes, created_by)
  values (p_branch, p_patient, p_appointment,
    (select invoice_prefix from public.clinic_settings) || '-' || to_char(now() at time zone private.org_tz(), 'YYYY') || '-'
      || lpad(private.next_number('invoice')::text, 6, '0'),
    private.org_today(), v_fee, 0, 0, v_fee, p_note, auth.uid())
  returning * into v_invoice;
  insert into public.invoice_items (invoice_id, position, item_type, description, quantity, unit_price_paise, tax_rate, line_total_paise, tax_paise)
  values (v_invoice.id, 0, 'consultation', 'Consultation', 1, v_fee, 0, v_fee, 0);
  return v_invoice.id;
end;
$$;
revoke execute on function private.sync_fee_invoice(uuid, bigint, uuid, uuid, uuid, text) from public;

-- ---------------------------------------------------------------- consultations

-- The invoice link is set only by the finalize action.
create or replace function private.lock_finalized_consultation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'finalized' then
    raise exception 'Finalized consultations cannot be modified' using errcode = '42501';
  end if;
  if new.invoice_id is distinct from old.invoice_id and coalesce(current_setting('vaidyora.consult_rpc', true), '') <> 'on' then
    raise exception 'The consultation invoice is raised only by finalizing' using errcode = '42501';
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

create or replace function private.guard_consultation_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.invoice_id is not null then
    raise exception 'The consultation invoice is raised only by finalizing' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger consultations_insert_guard before insert on public.consultations
  for each row execute function private.guard_consultation_insert();

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
      clinical_findings, assessment, diagnosis, ayurvedic_diagnosis, treatment_plan, pathya, apathya, follow_up_date, doctor_notes,
      consultation_fee_paise
    ) values (
      r.patient_id, r.appointment_id, r.branch_id, r.chief_complaint, r.pain_details, r.history_of_present_illness, r.past_history,
      r.pulse_bpm, r.bp_systolic, r.bp_diastolic, r.temperature_c, r.weight_kg, r.height_cm, r.spo2_percent,
      r.clinical_findings, r.assessment, r.diagnosis, r.ayurvedic_diagnosis, r.treatment_plan, r.pathya, r.apathya, r.follow_up_date, r.doctor_notes,
      r.consultation_fee_paise
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
      pathya = r.pathya, apathya = r.apathya, follow_up_date = r.follow_up_date, doctor_notes = r.doctor_notes,
      consultation_fee_paise = r.consultation_fee_paise
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
  v_invoice uuid;
begin
  select * into v_row from public.consultations where id = p_consultation for update;
  if not found or not private.can('consultations.edit') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_row.status = 'finalized' then
    return v_row;
  end if;
  v_invoice := private.sync_fee_invoice(v_row.invoice_id, v_row.consultation_fee_paise, v_row.patient_id, v_row.branch_id,
    v_row.appointment_id, 'Consultation on ' || to_char(v_row.visit_date, 'DD/MM/YYYY'));
  perform set_config('vaidyora.consult_rpc', 'on', true);
  update public.consultations set status = 'finalized', finalized_at = now(), invoice_id = v_invoice
   where id = p_consultation returning * into v_row;
  perform set_config('vaidyora.consult_rpc', 'off', true);
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

-- ---------------------------------------------------------------- standalone prescriptions

-- The invoice link is set only by the issue action.
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
     or new.invoice_id is distinct from old.invoice_id
     or (new.status = 'issued' and old.status <> 'issued') then
    raise exception 'Prescriptions are issued and revised only through the issue and revise actions' using errcode = '42501';
  end if;
  if old.status <> 'draft' and not (old.status = 'issued' and new.status = 'cancelled') then
    raise exception 'Issued prescriptions can only be cancelled or revised' using errcode = '42501';
  end if;
  return new;
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
    insert into public.prescriptions (patient_id, consultation_id, branch_id, notes, language, patient_instructions, follow_up_date, consultation_fee_paise)
    values (p_patient, p_consultation, h.branch_id, nullif(trim(h.notes), ''), coalesce(h.language, 'en'),
            nullif(trim(h.patient_instructions), ''), h.follow_up_date,
            case when p_consultation is null then h.consultation_fee_paise end)
    returning id into v_id;
  else
    update public.prescriptions
       set notes = nullif(trim(h.notes), ''), language = coalesce(h.language, 'en'),
           patient_instructions = nullif(trim(h.patient_instructions), ''), follow_up_date = h.follow_up_date,
           consultation_fee_paise = case when consultation_id is null then h.consultation_fee_paise end
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
  v_invoice uuid;
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

  v_invoice := private.sync_fee_invoice(v_row.invoice_id, v_row.consultation_fee_paise, v_row.patient_id, v_row.branch_id,
    null, 'Prescription ' || v_row.prescription_no);
  if v_invoice is distinct from v_row.invoice_id then
    update public.prescriptions set invoice_id = v_invoice where id = p_prescription returning * into v_row;
  end if;
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
