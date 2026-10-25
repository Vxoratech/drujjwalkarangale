-- =============================================================================
-- Vaidyora — 0001 Tenancy, identity and role-based access control
-- =============================================================================
-- Design notes
--   * Every tenant-owned row carries clinic_id. Child tables use composite
--     foreign keys (id, clinic_id) so a row can never point at another
--     tenant's data, even through a buggy client.
--   * Authorization is data-driven: roles map to permission keys in
--     role_permissions. Adding Receptionist/Accountant/... is a data change,
--     not a schema change.
--   * A member can hold several roles in one clinic (e.g. owner who is both
--     Admin and Doctor).
--   * Privileged helpers live in the non-exposed "private" schema.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
create type public.app_role as enum (
  'super_admin', 'admin', 'doctor', 'receptionist', 'accountant', 'pharmacist', 'branch_manager'
);
create type public.member_status as enum ('active', 'invited', 'suspended');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.prevent_clinic_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'clinic_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clinics (tenants) and branches
-- -----------------------------------------------------------------------------
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
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
  timezone text not null default 'Asia/Kolkata',
  currency char(3) not null default 'INR',
  default_locale text not null default 'en' check (default_locale in ('en', 'mr')),
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{2,8}$'),
  consultation_fee_paise bigint not null default 0 check (consultation_fee_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger clinics_updated_at before update on public.clinics
  for each row execute function private.set_updated_at();

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  address_line text check (char_length(address_line) <= 240),
  city text check (char_length(city) <= 80),
  phone text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id)
);
create index branches_clinic_idx on public.branches (clinic_id);
create unique index branches_one_primary on public.branches (clinic_id) where is_primary;
create trigger branches_updated_at before update on public.branches
  for each row execute function private.set_updated_at();
create trigger branches_clinic_immutable before update on public.branches
  for each row execute function private.prevent_clinic_change();

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  phone text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'mr')),
  qualification text check (char_length(qualification) <= 120),
  medical_registration_no text check (char_length(medical_registration_no) <= 60),
  signature_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'full_name', 120), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Membership and RBAC
-- -----------------------------------------------------------------------------
create table public.clinic_members (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  roles public.app_role[] not null check (cardinality(roles) > 0),
  status public.member_status not null default 'active',
  default_branch_id uuid,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, user_id),
  foreign key (default_branch_id, clinic_id) references public.branches (id, clinic_id)
);
create index clinic_members_user_idx on public.clinic_members (user_id);
create trigger clinic_members_updated_at before update on public.clinic_members
  for each row execute function private.set_updated_at();
create trigger clinic_members_clinic_immutable before update on public.clinic_members
  for each row execute function private.prevent_clinic_change();

create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);

create table public.role_permissions (
  role public.app_role not null,
  permission text not null references public.permissions (key) on delete cascade,
  primary key (role, permission)
);

-- -----------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so policies don't recurse)
-- -----------------------------------------------------------------------------
create or replace function private.is_member(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = p_clinic and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function private.has_permission(p_clinic uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_members m
    join public.role_permissions rp on rp.role = any (m.roles)
    where m.clinic_id = p_clinic
      and m.user_id = auth.uid()
      and m.status = 'active'
      and rp.permission = p_permission
  );
$$;

create or replace function private.has_role(p_clinic uuid, p_user uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = p_clinic and m.user_id = p_user and m.status = 'active' and p_role = any (m.roles)
  );
$$;

create or replace function private.shares_clinic(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_members me
    join public.clinic_members other on other.clinic_id = me.clinic_id
    where me.user_id = auth.uid() and me.status = 'active' and other.user_id = p_user
  );
$$;

-- Policy helpers must be executable by the API role; everything else in
-- "private" stays callable only from SECURITY DEFINER code.
revoke execute on all functions in schema private from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;
grant execute on function private.has_role(uuid, uuid, public.app_role) to authenticated;
grant execute on function private.shares_clinic(uuid) to authenticated;

-- Exposed RPC: the permission keys the caller holds in a clinic. The UI uses
-- this to shape navigation; enforcement always happens in RLS/RPCs.
create or replace function public.my_permissions(p_clinic uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rp.permission
  from public.clinic_members m
  join public.role_permissions rp on rp.role = any (m.roles)
  where m.clinic_id = p_clinic and m.user_id = auth.uid() and m.status = 'active'
  order by 1;
$$;

-- Prevent a clinic from losing its last active admin.
create or replace function private.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_losing_admin boolean;
begin
  if tg_op = 'DELETE' then
    v_losing_admin := true;
  else
    v_losing_admin := not ('admin' = any (new.roles)) or new.status <> 'active';
  end if;

  if v_losing_admin and 'admin' = any (old.roles) and old.status = 'active' and not exists (
    select 1 from public.clinic_members m
    where m.clinic_id = old.clinic_id and m.id <> old.id and m.status = 'active' and 'admin' = any (m.roles)
  ) then
    raise exception 'A clinic must keep at least one active admin' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger clinic_members_protect_last_admin
  before update or delete on public.clinic_members
  for each row execute function private.protect_last_admin();

-- -----------------------------------------------------------------------------
-- Atomic per-clinic counters for human-readable numbers (P-000001, INV-…)
-- -----------------------------------------------------------------------------
create table private.clinic_counters (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  kind text not null,
  value bigint not null default 0,
  primary key (clinic_id, kind)
);

create or replace function private.next_number(p_clinic uuid, p_kind text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into private.clinic_counters as c (clinic_id, kind, value)
  values (p_clinic, p_kind, 1)
  on conflict (clinic_id, kind) do update set value = c.value + 1
  returning value;
$$;

-- -----------------------------------------------------------------------------
-- Onboarding: a signed-in user creates a clinic and becomes its admin.
-- -----------------------------------------------------------------------------
create or replace function public.create_clinic(
  p_name text,
  p_city text default null,
  p_phone text default null,
  p_is_practitioner boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic uuid;
  v_branch uuid;
  v_roles public.app_role[];
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.clinics (name, city, phone)
  values (trim(p_name), nullif(trim(p_city), ''), nullif(trim(p_phone), ''))
  returning id into v_clinic;

  insert into public.branches (clinic_id, name, city, is_primary)
  values (v_clinic, 'Main', nullif(trim(p_city), ''), true)
  returning id into v_branch;

  v_roles := case when p_is_practitioner then array['admin', 'doctor']::public.app_role[]
                  else array['admin']::public.app_role[] end;

  insert into public.clinic_members (clinic_id, user_id, roles, default_branch_id)
  values (v_clinic, v_uid, v_roles, v_branch);

  return v_clinic;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.clinics enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.clinic_members enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

create policy clinics_select on public.clinics for select to authenticated
  using (private.is_member(id));
create policy clinics_update on public.clinics for update to authenticated
  using (private.has_permission(id, 'settings.manage'))
  with check (private.has_permission(id, 'settings.manage'));

create policy branches_select on public.branches for select to authenticated
  using (private.is_member(clinic_id));
create policy branches_insert on public.branches for insert to authenticated
  with check (private.has_permission(clinic_id, 'settings.manage'));
create policy branches_update on public.branches for update to authenticated
  using (private.has_permission(clinic_id, 'settings.manage'))
  with check (private.has_permission(clinic_id, 'settings.manage'));

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.shares_clinic(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Members: everybody sees their own memberships; staff managers see the roster.
create policy members_select on public.clinic_members for select to authenticated
  using (user_id = auth.uid() or private.is_member(clinic_id));
create policy members_update on public.clinic_members for update to authenticated
  using (private.has_permission(clinic_id, 'users.manage'))
  with check (private.has_permission(clinic_id, 'users.manage'));
-- Inserts happen through create_clinic() or the invite-member Edge Function.

create policy permissions_select on public.permissions for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Grants (RLS still applies)
-- -----------------------------------------------------------------------------
revoke all on public.clinics, public.branches, public.profiles, public.clinic_members,
  public.permissions, public.role_permissions from anon;
grant select, update on public.clinics to authenticated;
grant select, insert, update on public.branches to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.clinic_members to authenticated;
grant select on public.permissions, public.role_permissions to authenticated;

revoke execute on function public.create_clinic(text, text, text, boolean) from public, anon;
grant execute on function public.create_clinic(text, text, text, boolean) to authenticated;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;
