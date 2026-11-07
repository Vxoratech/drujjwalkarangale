-- =============================================================================
-- Vaidyora — 0100 Organization foundation (single-organization baseline)
-- =============================================================================
-- Vaidyora serves exactly one clinic organization owned by Dr. Ujjwal
-- Karangale, its only doctor. There is no tenant column: isolation is by
-- permission and by branch (see 0200). This file creates the organization,
-- its settings, branches, user profiles, counters and the audit trail.
-- Row Level Security is enabled here; policies follow in 0200, once the
-- authorization helpers exist.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
create type public.account_type as enum ('primary_doctor', 'admin', 'staff');
create type public.staff_status as enum ('invited', 'active', 'inactive');
create type public.staff_designation as enum (
  'receptionist', 'clinic_coordinator', 'accountant', 'billing_executive', 'assistant', 'branch_manager', 'other'
);
create type public.employment_type as enum ('full_time', 'part_time', 'contract', 'visiting');
create type public.permission_sensitivity as enum ('normal', 'sensitive', 'clinical');
create type public.override_effect as enum ('grant', 'deny');

-- -----------------------------------------------------------------------------
-- Generic trigger helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.set_updated_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

create or replace function private.immutable_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% records are immutable', tg_table_name using errcode = '42501';
end;
$$;

-- True inside trusted identity functions (bootstrap, account linking). Only
-- SECURITY DEFINER code running as the owner can set it; API roles cannot
-- change account types even if they set the flag themselves.
create or replace function private.identity_op()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('vaidyora.identity_op', true), '') = 'on'
     and current_user not in ('authenticated', 'anon');
$$;

-- -----------------------------------------------------------------------------
-- User profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  account_type public.account_type not null default 'staff',
  full_name text not null default '' check (char_length(full_name) <= 120),
  email text check (char_length(email) <= 254),
  phone text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'mr')),
  qualification text check (char_length(qualification) <= 120),
  medical_registration_no text check (char_length(medical_registration_no) <= 60),
  signature_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one primary doctor can ever exist.
create unique index user_profiles_one_primary_doctor on public.user_profiles (account_type) where account_type = 'primary_doctor';
create index user_profiles_account_type_idx on public.user_profiles (account_type);
create trigger user_profiles_updated_at before update on public.user_profiles
  for each row execute function private.set_updated_at();

-- Account type and activation are identity facts: they change only inside
-- trusted identity functions, never through an ordinary profile update.
create or replace function private.protect_profile_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.account_type <> 'staff' and not private.identity_op() then
      raise exception 'Account type is assigned only by trusted setup' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.account_type is distinct from old.account_type or new.is_active is distinct from old.is_active)
     and not private.identity_op() then
    raise exception 'Account type and access are changed only through staff management' using errcode = '42501';
  end if;
  if old.account_type = 'primary_doctor' and (new.account_type <> 'primary_doctor' or not new.is_active) then
    raise exception 'The primary doctor account cannot be changed or deactivated' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger user_profiles_protect_identity before insert or update on public.user_profiles
  for each row execute function private.protect_profile_identity();
create trigger user_profiles_no_delete before delete on public.user_profiles
  for each row when (old.account_type = 'primary_doctor') execute function private.immutable_row();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_profiles (id, full_name, email)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'full_name', 120), ''), left(new.email, 254))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Accounts that already exist (e.g. after a database reset) get a profile with
-- no access until staff management or trusted setup grants it.
insert into public.user_profiles (id, full_name, email)
select u.id, coalesce(left(u.raw_user_meta_data ->> 'full_name', 120), ''), left(u.email, 254)
from auth.users u
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- The organization (exactly one row) and its settings
-- -----------------------------------------------------------------------------
create table public.organization (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  name text not null check (char_length(name) between 2 and 120),
  legal_name text check (char_length(legal_name) <= 160),
  phone text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address_line text check (char_length(address_line) <= 240),
  city text check (char_length(city) <= 80),
  state text check (char_length(state) <= 80),
  pincode text check (pincode ~ '^[1-9][0-9]{5}$'),
  gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  registration_no text check (char_length(registration_no) <= 60),
  logo_path text,
  primary_doctor_id uuid unique references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create trigger organization_updated_at before update on public.organization
  for each row execute function private.set_updated_at();
create trigger organization_updated_by before update on public.organization
  for each row execute function private.set_updated_by();
create trigger organization_no_delete before delete on public.organization
  for each row execute function private.immutable_row();

-- The primary doctor is bound once, by trusted setup, and never replaced.
create or replace function private.protect_primary_doctor()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.primary_doctor_id is distinct from old.primary_doctor_id then
    if old.primary_doctor_id is not null then
      raise exception 'The primary doctor cannot be changed' using errcode = '42501';
    end if;
    if not private.identity_op() then
      raise exception 'The primary doctor is bound only by trusted setup' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger organization_protect_primary_doctor before update on public.organization
  for each row execute function private.protect_primary_doctor();

create table public.clinic_settings (
  organization_id uuid primary key references public.organization (id),
  timezone text not null default 'Asia/Kolkata',
  currency char(3) not null default 'INR',
  default_locale text not null default 'en' check (default_locale in ('en', 'mr')),
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{2,8}$'),
  consultation_fee_paise bigint not null default 0 check (consultation_fee_paise >= 0),
  brand_accent text check (brand_accent ~ '^#[0-9A-Fa-f]{6}$'),
  prescription_footer text check (char_length(prescription_footer) <= 500),
  audit_retention_days integer not null default 2920 check (audit_retention_days between 1095 and 7300),
  preferences jsonb not null default '{}' check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create trigger clinic_settings_updated_at before update on public.clinic_settings
  for each row execute function private.set_updated_at();
create trigger clinic_settings_updated_by before update on public.clinic_settings
  for each row execute function private.set_updated_by();
create trigger clinic_settings_no_delete before delete on public.clinic_settings
  for each row execute function private.immutable_row();

create or replace function private.validate_clinic_settings()
returns trigger language plpgsql set search_path = '' as $$
declare
  s jsonb := new.preferences;
  k text;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone' using errcode = '23514';
  end if;
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
  -- The demo banner is set by operators with SQL, not from the app.
  if tg_op = 'UPDATE' and (s -> 'demo') is distinct from (old.preferences -> 'demo')
     and current_user in ('authenticated', 'anon') then
    raise exception 'The demo flag is managed by operators' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clinic_settings_validate before insert or update on public.clinic_settings
  for each row execute function private.validate_clinic_settings();

create or replace function private.org_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.organization;
$$;

create or replace function private.org_tz()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select timezone from public.clinic_settings), 'Asia/Kolkata');
$$;

create or replace function private.org_today()
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone private.org_tz())::date;
$$;

-- -----------------------------------------------------------------------------
-- Branches and working hours
-- -----------------------------------------------------------------------------
create table public.clinic_branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  name text not null check (char_length(name) between 2 and 120),
  address_line text check (char_length(address_line) <= 240),
  city text check (char_length(city) <= 80),
  state text check (char_length(state) <= 80),
  pincode text check (pincode ~ '^[1-9][0-9]{5}$'),
  phone text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_primary boolean not null default false,
  is_active boolean not null default true,
  manager_staff_id uuid, -- foreign key added in 0200 with staff_members
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (is_active or not is_primary)
);
create unique index clinic_branches_one_primary on public.clinic_branches ((true)) where is_primary;
create index clinic_branches_active_idx on public.clinic_branches (is_active, name);
create trigger clinic_branches_updated_at before update on public.clinic_branches
  for each row execute function private.set_updated_at();
create trigger clinic_branches_updated_by before update on public.clinic_branches
  for each row execute function private.set_updated_by();
create trigger clinic_branches_no_delete before delete on public.clinic_branches
  for each row execute function private.immutable_row();

create table public.branch_working_hours (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.clinic_branches (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  opens_at time not null,
  closes_at time not null,
  slot_minutes smallint not null default 15 check (slot_minutes between 5 and 240),
  created_at timestamptz not null default now(),
  check (closes_at > opens_at)
);
create index branch_working_hours_branch_idx on public.branch_working_hours (branch_id, weekday, opens_at);

-- Primary branch fallback for rows created without an explicit branch.
create or replace function private.primary_branch()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.clinic_branches where is_primary;
$$;

-- -----------------------------------------------------------------------------
-- Human-readable numbering (P-000001, INV-2026-000001, …)
-- -----------------------------------------------------------------------------
create table private.counters (
  kind text primary key,
  value bigint not null default 0
);

create or replace function private.next_number(p_kind text)
returns bigint language sql security definer set search_path = '' as $$
  insert into private.counters as c (kind, value) values (p_kind, 1)
  on conflict (kind) do update set value = c.value + 1
  returning value;
$$;

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed windows)
-- -----------------------------------------------------------------------------
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

create or replace function private.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  delete from private.rate_limits where key = p_key and window_start < v_window;
  insert into private.rate_limits as r (key, window_start, hits) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Trusted server code (Edge Functions) rate-limits with this.
create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language sql security definer set search_path = '' as $$
  select private.hit_rate_limit(p_key, p_limit, p_window_seconds);
$$;

-- -----------------------------------------------------------------------------
-- Audit trail: append-only, never holds clinical values
-- -----------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid, -- no foreign key: events outlive accounts and are never updated
  actor_type text not null default 'user' check (actor_type in ('user', 'system')),
  action text not null check (action in ('insert', 'update', 'delete', 'view', 'access', 'security', 'permission')),
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type text not null,
  entity_id uuid,
  branch_id uuid,
  changed_fields text[] not null default '{}',
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on public.audit_events (created_at desc);
create index audit_events_type_idx on public.audit_events (event_type, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index audit_events_actor_idx on public.audit_events (actor_id, created_at desc);
create index audit_events_branch_idx on public.audit_events (branch_id, created_at desc) where branch_id is not null;

create or replace function private.audit_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
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
  p_event_type text, p_action text, p_entity_type text, p_entity_id uuid,
  p_changed_fields text[] default '{}', p_metadata jsonb default '{}', p_branch uuid default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events (actor_id, actor_type, action, event_type, entity_type, entity_id, branch_id, changed_fields, metadata)
  values (auth.uid(), case when auth.uid() is null then 'system' else 'user' end, p_action, p_event_type,
          p_entity_type, p_entity_id, p_branch, coalesce(p_changed_fields, '{}'), coalesce(p_metadata, '{}'));
end;
$$;

-- Row-change audit. Records which fields changed and non-clinical context
-- (status transitions, permission keys, branch links), never the values.
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[] := '{}';
  v_meta jsonb := '{}';
  v_entity uuid;
  v_branch uuid;
begin
  v_entity := coalesce((v_row ->> 'id')::uuid, (v_row ->> 'staff_id')::uuid, (v_row ->> 'role_id')::uuid);
  v_branch := case when tg_table_name = 'clinic_branches' then (v_row ->> 'id')::uuid else (v_row ->> 'branch_id')::uuid end;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'updated_by') and n.value is distinct from v_old -> n.key;
    if cardinality(v_changed) = 0 then
      return new;
    end if;
  end if;

  if tg_table_name = 'user_profiles' then
    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'account_type_before', v_old -> 'account_type', 'account_type_after', v_new -> 'account_type',
      'active_before', v_old -> 'is_active', 'active_after', v_new -> 'is_active'));
  elsif tg_table_name = 'staff_members' then
    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'status_before', v_old -> 'status', 'status_after', v_new -> 'status',
      'role_before', v_old -> 'role_id', 'role_after', v_new -> 'role_id',
      'designation', v_row -> 'designation'));
  elsif tg_table_name in ('staff_permission_overrides', 'role_permissions') then
    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'staff_id', v_row -> 'staff_id', 'role_id', v_row -> 'role_id',
      'permission', v_row -> 'permission_key', 'effect', v_row -> 'effect'));
  elsif tg_table_name = 'staff_branch_assignments' then
    v_meta := jsonb_build_object('staff_id', v_row -> 'staff_id', 'branch_id', v_row -> 'branch_id');
  elsif tg_table_name in ('appointments', 'invoices', 'prescriptions', 'consultations', 'investigations', 'follow_ups', 'patient_consents', 'patients')
        and 'status' = any (v_changed || case when tg_op = 'INSERT' then array['status'] else '{}' end) then
    v_meta := jsonb_strip_nulls(jsonb_build_object('status_from', v_old -> 'status', 'status_to', v_new -> 'status'));
  end if;
  if tg_table_name = 'prescriptions' then
    v_meta := v_meta || jsonb_build_object('revision_number', v_row -> 'revision_number');
  end if;

  perform private.log_event(tg_table_name || '.' || lower(tg_op), lower(tg_op), tg_table_name, v_entity, v_changed, v_meta, v_branch);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger user_profiles_audit after insert or update or delete on public.user_profiles
  for each row execute function private.audit_row();
create trigger organization_audit after update on public.organization
  for each row execute function private.audit_row();
create trigger clinic_settings_audit after update on public.clinic_settings
  for each row execute function private.audit_row();
create trigger clinic_branches_audit after insert or update on public.clinic_branches
  for each row execute function private.audit_row();
create trigger branch_working_hours_audit after insert or update or delete on public.branch_working_hours
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- The one organization, its settings and its primary branch
-- -----------------------------------------------------------------------------
insert into public.organization (name, city, state)
values ('Dr. Ujjwal Karangale Ayurvedic Clinic', 'Pune', 'Maharashtra');
insert into public.clinic_settings (organization_id) select id from public.organization;
insert into public.clinic_branches (code, name, city, state, is_primary)
values ('MAIN', 'Main Clinic', 'Pune', 'Maharashtra', true);

-- -----------------------------------------------------------------------------
-- Row Level Security on (policies in 0200)
-- -----------------------------------------------------------------------------
alter table public.user_profiles enable row level security;
alter table public.organization enable row level security;
alter table public.clinic_settings enable row level security;
alter table public.clinic_branches enable row level security;
alter table public.branch_working_hours enable row level security;
alter table public.audit_events enable row level security;

revoke all on public.user_profiles, public.organization, public.clinic_settings, public.clinic_branches,
  public.branch_working_hours, public.audit_events from anon;
revoke execute on all functions in schema private from public;
revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
