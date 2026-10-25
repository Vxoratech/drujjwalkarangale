-- =============================================================================
-- Vaidyora — 0006 Transactional saves for multi-row clinical documents
-- =============================================================================
-- SECURITY INVOKER: every statement still runs under the caller's RLS
-- policies; the functions exist only so related rows commit atomically.
-- =============================================================================

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
      clinical_findings, diagnosis, ayurvedic_diagnosis, treatment_plan, pathya, apathya, follow_up_date
    ) values (
      p_clinic, r.patient_id, auth.uid(), r.appointment_id, r.chief_complaint, r.history_of_present_illness, r.past_history,
      r.pulse_bpm, r.bp_systolic, r.bp_diastolic, r.temperature_c, r.weight_kg, r.height_cm, r.spo2_percent,
      r.clinical_findings, r.diagnosis, r.ayurvedic_diagnosis, r.treatment_plan, r.pathya, r.apathya, r.follow_up_date
    ) returning id into v_id;

    -- Opening a consultation from a booked visit moves it into consultation.
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
      clinical_findings = r.clinical_findings, diagnosis = r.diagnosis, ayurvedic_diagnosis = r.ayurvedic_diagnosis,
      treatment_plan = r.treatment_plan, pathya = r.pathya, apathya = r.apathya, follow_up_date = r.follow_up_date
    where id = p_id and clinic_id = p_clinic
    returning id into v_id;
    if v_id is null then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
  end if;

  insert into public.ayurvedic_examinations (
    clinic_id, consultation_id, patient_id, prakriti, vikriti, agni, koshtha, bala,
    nadi, mutra, mala, jihva, shabda, sparsha, drik, akriti, sara, satva, notes
  )
  select p_clinic, v_id, c.patient_id, e.prakriti, coalesce(e.vikriti, '{}'), e.agni, e.koshtha, e.bala,
         e.nadi, e.mutra, e.mala, e.jihva, e.shabda, e.sparsha, e.drik, e.akriti, e.sara, e.satva, e.notes
  from public.consultations c where c.id = v_id
  on conflict (consultation_id) do update set
    prakriti = excluded.prakriti, vikriti = excluded.vikriti, agni = excluded.agni, koshtha = excluded.koshtha,
    bala = excluded.bala, nadi = excluded.nadi, mutra = excluded.mutra, mala = excluded.mala, jihva = excluded.jihva,
    shabda = excluded.shabda, sparsha = excluded.sparsha, drik = excluded.drik, akriti = excluded.akriti,
    sara = excluded.sara, satva = excluded.satva, notes = excluded.notes;

  return v_id;
end;
$$;

create or replace function public.save_prescription_draft(
  p_clinic uuid,
  p_id uuid,
  p_patient uuid,
  p_consultation uuid,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 50 then
    raise exception 'Too many line items' using errcode = '23514';
  end if;

  if p_id is null then
    insert into public.prescriptions (clinic_id, patient_id, doctor_id, consultation_id, notes)
    values (p_clinic, p_patient, auth.uid(), p_consultation, nullif(trim(p_notes), ''))
    returning id into v_id;
  else
    update public.prescriptions set notes = nullif(trim(p_notes), '')
    where id = p_id and clinic_id = p_clinic and status = 'draft'
    returning id into v_id;
    if v_id is null then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    delete from public.prescription_items where prescription_id = v_id;
  end if;

  insert into public.prescription_items (
    clinic_id, prescription_id, position, medicine_name, form, dose, frequency, timing, anupana, duration_days, instructions
  )
  select p_clinic, v_id, (i.ordinality - 1)::smallint, (i.r).medicine_name, coalesce((i.r).form, 'other'), (i.r).dose, (i.r).frequency,
         coalesce((i.r).timing, 'after_food'), (i.r).anupana, (i.r).duration_days, (i.r).instructions
  from (
    select jsonb_populate_record(null::public.prescription_items, x.value) as r, x.ordinality
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(value, ordinality)
  ) i;

  return v_id;
end;
$$;

revoke execute on function public.save_consultation(uuid, uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.save_prescription_draft(uuid, uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.save_consultation(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.save_prescription_draft(uuid, uuid, uuid, uuid, text, jsonb) to authenticated;
