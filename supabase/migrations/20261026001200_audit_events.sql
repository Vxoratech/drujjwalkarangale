-- =============================================================================
-- Vaidyora — 0012 Audit events
-- =============================================================================
-- audit_logs becomes audit_events: typed, append-only, PHI-free.
--   * Row changes are recorded by trigger (event_type '<table>.<action>').
--   * Reads of patient records are recorded by view_patient().
--   * Document downloads are recorded by the document-url Edge Function.
--   * Session events are client-reported (log_session_event); authoritative
--     authentication events live in Supabase's auth.audit_log_entries.
-- Metadata may hold identifiers, statuses, roles and field NAMES — never
-- names, phone numbers, notes or other clinical/personal values.
-- =============================================================================

alter table public.audit_logs rename to audit_events;
alter policy audit_logs_select on public.audit_events rename to audit_events_select;
alter index audit_logs_clinic_created_idx rename to audit_events_clinic_created_idx;
alter index audit_logs_entity_idx rename to audit_events_entity_idx;

alter table public.audit_events
  alter column clinic_id drop not null,
  add column event_type text,
  add column actor_type text not null default 'user' check (actor_type in ('user', 'platform', 'system')),
  add column metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096);
alter table public.audit_events drop constraint audit_logs_action_check;
alter table public.audit_events add constraint audit_events_action_check
  check (action in ('insert', 'update', 'delete', 'view', 'access', 'security'));
update public.audit_events set event_type = entity_type || '.' || action where event_type is null;
alter table public.audit_events alter column event_type set not null,
  add constraint audit_events_event_type_format check (event_type ~ '^[a-z_]+\.[a-z_]+$');
create index audit_events_type_idx on public.audit_events (clinic_id, event_type, created_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id, created_at desc);

-- Append-only: no UPDATE/DELETE except the retention purge.
create or replace function private.audit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('vaidyora.audit_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Audit events cannot be modified' using errcode = '42501';
end;
$$;
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function private.audit_events_append_only();

create or replace function private.log_event(
  p_clinic uuid,
  p_event_type text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_changed_fields text[] default '{}',
  p_metadata jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_type text := case
    when auth.uid() is null then 'system'
    when p_clinic is not null and not exists (select 1 from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = auth.uid())
         and private.is_platform_admin() then 'platform'
    else 'user' end;
begin
  insert into public.audit_events (clinic_id, actor_id, actor_type, action, event_type, entity_type, entity_id, changed_fields, metadata)
  values (p_clinic, auth.uid(), v_actor_type, p_action, p_event_type, p_entity_type, p_entity_id, coalesce(p_changed_fields, '{}'), coalesce(p_metadata, '{}'));
end;
$$;

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
  v_meta jsonb := '{}';
  v_clinic uuid;
  v_entity uuid;
begin
  v_clinic := case when tg_table_name = 'clinics' then (v_row ->> 'id')::uuid else (v_row ->> 'clinic_id')::uuid end;
  v_entity := coalesce((v_row ->> 'id')::uuid, (v_row ->> 'user_id')::uuid);

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'updated_by') and n.value is distinct from v_old -> n.key;
    if cardinality(v_changed) = 0 then
      return new;
    end if;
  end if;

  -- Non-PHI context for security-relevant changes.
  if tg_table_name = 'clinic_members' then
    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'user_id', v_row ->> 'user_id',
      'roles_before', v_old -> 'roles', 'roles_after', v_new -> 'roles',
      'status_before', v_old -> 'status', 'status_after', v_new -> 'status'));
  elsif tg_table_name in ('appointments', 'invoices', 'prescriptions', 'consultations', 'investigations', 'follow_ups',
                          'tenant_subscriptions', 'clinics', 'patient_consents') and 'status' = any (v_changed || case when tg_op = 'INSERT' then array['status'] else '{}' end) then
    v_meta := jsonb_strip_nulls(jsonb_build_object('status_from', v_old -> 'status', 'status_to', v_new -> 'status'));
  end if;
  if tg_table_name = 'prescriptions' then
    v_meta := v_meta || jsonb_build_object('revision_number', v_row -> 'revision_number');
  elsif tg_table_name = 'member_branches' then
    v_meta := jsonb_build_object('member_id', v_row -> 'member_id', 'branch_id', v_row -> 'branch_id');
  end if;

  perform private.log_event(v_clinic, tg_table_name || '.' || lower(tg_op), lower(tg_op), tg_table_name, v_entity, v_changed, v_meta);

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
    'patient_consents', 'patient_documents', 'follow_ups', 'prescription_items', 'prescription_revisions',
    'prescription_templates', 'refunds', 'tenant_subscriptions', 'member_branches', 'exam_field_definitions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()',
      t || '_audit', t
    );
  end loop;
end;
$$;

-- Platform admin changes are platform-level events (no clinic).
create or replace function private.audit_platform_admins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_event(null, 'platform_admins.' || lower(tg_op), case tg_op when 'DELETE' then 'delete' when 'INSERT' then 'insert' else 'update' end,
    'platform_admins', coalesce(new.user_id, old.user_id), '{}',
    jsonb_strip_nulls(jsonb_build_object('role_before', old.role, 'role_after', new.role)));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger platform_admins_audit after insert or update or delete on public.platform_admins
  for each row execute function private.audit_platform_admins();

drop policy audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select to authenticated
  using (
    (clinic_id is not null and private.has_permission(clinic_id, 'audit.read'))
    or (clinic_id is null and private.is_platform_admin())
  );

-- -----------------------------------------------------------------------------
-- Read access logging
-- -----------------------------------------------------------------------------
-- Returns the patient (RLS-scoped: no row → P0002) and records the view.
-- Repeat views by the same user within 10 minutes are collapsed.
create or replace function public.view_patient(p_patient uuid)
returns public.patients
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.patients;
begin
  select * into v_row from public.patients where id = p_patient;
  if not found then
    raise exception 'The record could not be found' using errcode = 'P0002';
  end if;
  perform private.log_patient_view(v_row.clinic_id, v_row.id);
  return v_row;
end;
$$;

create or replace function private.log_patient_view(p_clinic uuid, p_patient uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Re-check access under the definer's rights before writing.
  if not private.can_read_patient(p_clinic, p_patient) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.audit_events e
    where e.actor_id = auth.uid() and e.event_type = 'patients.viewed' and e.entity_id = p_patient
      and e.created_at > now() - interval '10 minutes'
  ) then
    perform private.log_event(p_clinic, 'patients.viewed', 'view', 'patients', p_patient);
  end if;
end;
$$;

-- Called by the document-url Edge Function (service role) after it has
-- verified the caller's access with the caller's own JWT.
create or replace function public.log_document_access(p_document uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.patient_documents;
begin
  select * into d from public.patient_documents where id = p_document;
  if not found then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  insert into public.audit_events (clinic_id, actor_id, actor_type, action, event_type, entity_type, entity_id, metadata)
  values (d.clinic_id, p_actor, 'user', 'access', 'patient_documents.accessed', 'patient_documents', d.id,
          jsonb_build_object('patient_id', d.patient_id, 'category', d.category));
end;
$$;

create or replace function public.log_session_event(p_clinic uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event not in ('session.signed_in', 'session.clinic_selected', 'session.signed_out') then
    raise exception 'Unknown session event' using errcode = '22023';
  end if;
  if not private.has_membership(p_clinic) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.log_event(p_clinic, p_event, 'security', 'session', auth.uid(), '{}', jsonb_build_object('client_reported', true));
end;
$$;

-- Retention: delete events older than each clinic's audit_retention_days.
-- Run from a trusted scheduler with the service role (e.g. pg_cron).
create or replace function public.purge_expired_audit_events()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  perform set_config('vaidyora.audit_purge', 'on', true);
  delete from public.audit_events e
  using public.clinics c
  where e.clinic_id = c.id and e.created_at < now() - make_interval(days => c.audit_retention_days);
  get diagnostics v_count = row_count;
  perform set_config('vaidyora.audit_purge', 'off', true);
  return v_count;
end;
$$;

revoke execute on function public.view_patient(uuid) from public, anon;
revoke execute on function public.log_document_access(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.log_session_event(uuid, text) from public, anon;
revoke execute on function public.purge_expired_audit_events() from public, anon, authenticated;
grant execute on function public.view_patient(uuid) to authenticated;
grant execute on function public.log_session_event(uuid, text) to authenticated;
grant execute on function public.log_document_access(uuid, uuid) to service_role;
grant execute on function public.purge_expired_audit_events() to service_role;

revoke execute on all functions in schema private from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_membership(uuid) to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;
grant execute on function private.has_role(uuid, uuid, public.app_role) to authenticated;
grant execute on function private.shares_clinic(uuid) to authenticated;
grant execute on function private.is_doctor_of_patient(uuid) to authenticated;
grant execute on function private.can_read_patient(uuid, uuid) to authenticated;
grant execute on function private.can_read_clinical(uuid, uuid) to authenticated;
grant execute on function private.can_write_clinical(uuid, uuid) to authenticated;
grant execute on function private.storage_can_read(text) to authenticated;
grant execute on function private.storage_can_write(text) to authenticated;
grant execute on function private.storage_can_upload(text) to authenticated;
grant execute on function private.in_branch_scope(uuid, uuid) to authenticated;
grant execute on function private.is_platform_admin(public.platform_role) to authenticated;
grant execute on function private.clinic_tz(uuid) to authenticated;
grant execute on function private.clinic_today(uuid) to authenticated;
grant execute on function private.log_patient_view(uuid, uuid) to authenticated;

-- Trusted server code (Edge Functions) manages branch scope during invitations.
grant select, insert, delete on public.member_branches to service_role;
