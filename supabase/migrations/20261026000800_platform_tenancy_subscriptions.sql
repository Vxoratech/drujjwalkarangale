-- =============================================================================
-- Vaidyora — 0008 Platform boundary, clinic lifecycle, branch scope, subscriptions
-- =============================================================================
-- Platform (Super Admin) authority is held in public.platform_admins and is
-- completely separate from clinic membership: a clinic admin never becomes a
-- platform admin, and a platform admin gets NO access to tenant clinical data.
-- Platform operations are limited to the platform_* RPCs below.
-- =============================================================================

-- Generic "who changed this" stamp used by many tables.
create or replace function private.set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clinics: lifecycle, configuration, branding
-- -----------------------------------------------------------------------------
alter table public.clinics
  add column status public.clinic_status not null default 'active',
  add column status_reason text check (char_length(status_reason) <= 500),
  add column settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384),
  add column brand_accent text check (brand_accent ~ '^#[0-9A-Fa-f]{6}$'),
  add column audit_retention_days integer not null default 2920 check (audit_retention_days between 1095 and 7300),
  add column updated_by uuid references auth.users (id) on delete set null;

create trigger clinics_updated_by before update on public.clinics
  for each row execute function private.set_updated_by();

-- Lifecycle fields may only be changed by the platform (status) RPCs.
create or replace function private.protect_clinic_platform_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.status is distinct from old.status or new.status_reason is distinct from old.status_reason)
     and coalesce(current_setting('vaidyora.platform_op', true), '') <> 'on' then
    raise exception 'Clinic status is managed by the platform' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clinics_protect_platform_fields before update on public.clinics
  for each row execute function private.protect_clinic_platform_fields();

create or replace function private.validate_clinic_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger clinics_validate_timezone before insert or update of timezone on public.clinics
  for each row execute function private.validate_clinic_timezone();

alter table public.branches
  add column email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column updated_by uuid references auth.users (id) on delete set null;
create trigger branches_updated_by before update on public.branches
  for each row execute function private.set_updated_by();

-- Clinic-local calendar helpers. Canonical instants are timestamptz (UTC);
-- the clinic's time zone is applied only for calendar dates and display.
create or replace function private.clinic_tz(p_clinic uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select timezone from public.clinics where id = p_clinic), 'Asia/Kolkata');
$$;

create or replace function private.clinic_today(p_clinic uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone private.clinic_tz(p_clinic))::date;
$$;

-- -----------------------------------------------------------------------------
-- Membership: invitations, activation, branch scope
-- -----------------------------------------------------------------------------
alter table public.clinic_members
  add column accepted_at timestamptz,
  add column updated_by uuid references auth.users (id) on delete set null;
update public.clinic_members set accepted_at = created_at where status = 'active';
create trigger clinic_members_updated_by before update on public.clinic_members
  for each row execute function private.set_updated_by();

-- Branch scope: no rows = member may work in every branch of the clinic.
create table public.member_branches (
  member_id uuid not null references public.clinic_members (id) on delete cascade,
  clinic_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (member_id, branch_id),
  foreign key (branch_id, clinic_id) references public.branches (id, clinic_id) on delete cascade
);
create index member_branches_clinic_idx on public.member_branches (clinic_id);

create or replace function private.validate_member_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.clinic_members m where m.id = new.member_id and m.clinic_id = new.clinic_id) then
    raise exception 'Branch and membership belong to different clinics' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger member_branches_validate before insert or update on public.member_branches
  for each row execute function private.validate_member_branch();

-- Membership checks now also require the clinic itself to be active.
create or replace function private.is_member(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_members m
    join public.clinics c on c.id = m.clinic_id
    where m.clinic_id = p_clinic and m.user_id = auth.uid() and m.status = 'active' and c.status = 'active'
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
    join public.clinics c on c.id = m.clinic_id
    join public.role_permissions rp on rp.role = any (m.roles)
    where m.clinic_id = p_clinic
      and m.user_id = auth.uid()
      and m.status = 'active'
      and c.status = 'active'
      and rp.permission = p_permission
  );
$$;

create or replace function public.my_permissions(p_clinic uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rp.permission
  from public.clinic_members m
  join public.clinics c on c.id = m.clinic_id
  join public.role_permissions rp on rp.role = any (m.roles)
  where m.clinic_id = p_clinic and m.user_id = auth.uid() and m.status = 'active' and c.status = 'active'
  order by 1;
$$;

-- Active membership regardless of clinic status (lets the UI explain a suspension).
create or replace function private.has_membership(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = p_clinic and m.user_id = auth.uid() and m.status in ('active', 'invited')
  );
$$;

create or replace function private.in_branch_scope(p_clinic uuid, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_branch is null or exists (
    select 1 from public.clinic_members m
    where m.clinic_id = p_clinic and m.user_id = auth.uid() and m.status = 'active'
      and (
        not exists (select 1 from public.member_branches mb where mb.member_id = m.id)
        or exists (select 1 from public.member_branches mb where mb.member_id = m.id and mb.branch_id = p_branch)
      )
  );
$$;

drop policy clinics_select on public.clinics;
create policy clinics_select on public.clinics for select to authenticated
  using (private.has_membership(id));

-- Members see their own memberships (including invitations) and, when the
-- clinic is active, the roster of their clinic.
drop policy members_select on public.clinic_members;
create policy members_select on public.clinic_members for select to authenticated
  using (user_id = auth.uid() or private.is_member(clinic_id));

-- Invitation acceptance: the invited user activates their own membership.
create or replace function public.accept_invitation(p_clinic uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.clinic_members
     set status = 'active', accepted_at = now()
   where clinic_id = p_clinic and user_id = auth.uid() and status = 'invited';
  if not found then
    raise exception 'No pending invitation' using errcode = 'P0002';
  end if;
end;
$$;

alter table public.member_branches enable row level security;
create policy member_branches_select on public.member_branches for select to authenticated
  using (private.is_member(clinic_id));
create policy member_branches_insert on public.member_branches for insert to authenticated
  with check (private.has_permission(clinic_id, 'users.manage'));
create policy member_branches_delete on public.member_branches for delete to authenticated
  using (private.has_permission(clinic_id, 'users.manage'));
revoke all on public.member_branches from anon;
grant select, insert, delete on public.member_branches to authenticated;

-- -----------------------------------------------------------------------------
-- Platform administrators (trusted boundary, provisioned only via SQL/service role)
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.platform_role not null default 'support',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
alter table public.platform_admins enable row level security;
create policy platform_admins_select_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());
revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;

create or replace function private.is_platform_admin(p_role public.platform_role default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid() and (p_role is null or pa.role = p_role or pa.role = 'owner')
  );
$$;

-- -----------------------------------------------------------------------------
-- SaaS subscriptions
-- -----------------------------------------------------------------------------
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text check (char_length(description) <= 500),
  price_paise bigint not null default 0 check (price_paise >= 0),
  billing_interval public.billing_interval not null default 'monthly',
  trial_days smallint not null default 0 check (trial_days between 0 and 90),
  -- { "max_doctors": int, "max_branches": int, "max_staff": int } — absent key = unlimited
  limits jsonb not null default '{}' check (jsonb_typeof(limits) = 'object'),
  is_public boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscription_plans_updated_at before update on public.subscription_plans
  for each row execute function private.set_updated_at();

-- One current subscription per clinic; history is kept in the audit trail.
create table public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references public.clinics (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id),
  status public.subscription_status not null,
  billing_interval public.billing_interval not null default 'monthly',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  -- Payment-provider abstraction: no provider integration yet ('manual').
  provider text not null default 'manual' check (provider in ('manual', 'razorpay', 'stripe')),
  provider_customer_ref text check (char_length(provider_customer_ref) <= 120),
  provider_subscription_ref text check (char_length(provider_subscription_ref) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (status <> 'trialing' or trial_ends_at is not null),
  check (current_period_end is null or current_period_start is null or current_period_end > current_period_start)
);
create index tenant_subscriptions_plan_idx on public.tenant_subscriptions (plan_id);
create trigger tenant_subscriptions_updated_at before update on public.tenant_subscriptions
  for each row execute function private.set_updated_at();
create trigger tenant_subscriptions_updated_by before update on public.tenant_subscriptions
  for each row execute function private.set_updated_by();

-- Placeholder catalogue (prices are illustrative, not commercial terms).
insert into public.subscription_plans (code, name, description, price_paise, billing_interval, trial_days, limits) values
  ('trial', 'Trial', '14-day evaluation', 0, 'monthly', 14, '{"max_doctors": 2, "max_branches": 1, "max_staff": 5}'),
  ('solo', 'Solo Practice', 'One practitioner, one location', 99900, 'monthly', 0, '{"max_doctors": 1, "max_branches": 1, "max_staff": 3}'),
  ('clinic', 'Clinic', 'Small clinics', 249900, 'monthly', 0, '{"max_doctors": 5, "max_branches": 1, "max_staff": 15}'),
  ('multi_branch', 'Multi-branch', 'Groups with several branches', 499900, 'monthly', 0, '{"max_doctors": 25, "max_branches": 10}')
on conflict (code) do nothing;

create or replace function private.plan_limit(p_clinic uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (p.limits ->> p_key)::integer
  from public.tenant_subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.clinic_id = p_clinic;
$$;

create or replace function private.enforce_branch_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.plan_limit(new.clinic_id, 'max_branches');
begin
  if v_limit is not null and new.is_active and (
    select count(*) from public.branches b where b.clinic_id = new.clinic_id and b.is_active and b.id <> new.id
  ) >= v_limit then
    raise exception 'Your plan allows up to % branches', v_limit using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger branches_plan_limit before insert or update of is_active on public.branches
  for each row execute function private.enforce_branch_limit();

create or replace function private.enforce_member_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doctors integer := private.plan_limit(new.clinic_id, 'max_doctors');
  v_staff integer := private.plan_limit(new.clinic_id, 'max_staff');
begin
  if new.status = 'suspended' then
    return new;
  end if;
  if v_doctors is not null and 'doctor' = any (new.roles) and (
    select count(*) from public.clinic_members m
    where m.clinic_id = new.clinic_id and m.id <> new.id and m.status <> 'suspended' and 'doctor' = any (m.roles)
  ) >= v_doctors then
    raise exception 'Your plan allows up to % doctors', v_doctors using errcode = 'P0001';
  end if;
  if v_staff is not null and tg_op = 'INSERT' and (
    select count(*) from public.clinic_members m where m.clinic_id = new.clinic_id and m.status <> 'suspended'
  ) >= v_staff then
    raise exception 'Your plan allows up to % staff accounts', v_staff using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger clinic_members_plan_limits before insert or update of roles, status on public.clinic_members
  for each row execute function private.enforce_member_limits();

alter table public.subscription_plans enable row level security;
alter table public.tenant_subscriptions enable row level security;
-- Public plan catalogue (non-tenant reference data).
create policy subscription_plans_select on public.subscription_plans for select to authenticated
  using ((is_public and is_active) or private.is_platform_admin());
create policy tenant_subscriptions_select on public.tenant_subscriptions for select to authenticated
  using (private.has_permission(clinic_id, 'subscription.read') or private.is_platform_admin());
revoke all on public.subscription_plans, public.tenant_subscriptions from anon, authenticated;
grant select on public.subscription_plans, public.tenant_subscriptions to authenticated;

-- Onboarding now starts every clinic on the trial plan.
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
  v_plan public.subscription_plans;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_plan from public.subscription_plans where code = 'trial';

  insert into public.clinics (name, city, phone)
  values (trim(p_name), nullif(trim(p_city), ''), nullif(trim(p_phone), ''))
  returning id into v_clinic;

  insert into public.tenant_subscriptions (clinic_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
  values (v_clinic, v_plan.id, 'trialing', now() + make_interval(days => v_plan.trial_days), now(), now() + make_interval(days => v_plan.trial_days));

  insert into public.branches (clinic_id, name, city, is_primary)
  values (v_clinic, 'Main', nullif(trim(p_city), ''), true)
  returning id into v_branch;

  insert into public.clinic_members (clinic_id, user_id, roles, default_branch_id, accepted_at)
  values (
    v_clinic, v_uid,
    case when p_is_practitioner then array['admin', 'doctor']::public.app_role[] else array['admin']::public.app_role[] end,
    v_branch, now()
  );

  return v_clinic;
end;
$$;

-- -----------------------------------------------------------------------------
-- Platform RPCs — metadata only, never patient or clinical data
-- -----------------------------------------------------------------------------
create or replace function public.platform_list_clinics()
returns table (
  clinic_id uuid, name text, city text, status public.clinic_status, created_at timestamptz,
  plan_code text, subscription_status public.subscription_status, current_period_end timestamptz,
  active_members bigint, branches bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select c.id, c.name, c.city, c.status, c.created_at, p.code, s.status, s.current_period_end,
         (select count(*) from public.clinic_members m where m.clinic_id = c.id and m.status = 'active'),
         (select count(*) from public.branches b where b.clinic_id = c.id and b.is_active)
  from public.clinics c
  left join public.tenant_subscriptions s on s.clinic_id = c.id
  left join public.subscription_plans p on p.id = s.plan_id
  order by c.created_at desc;
end;
$$;

create or replace function public.platform_set_clinic_status(p_clinic uuid, p_status public.clinic_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin('owner') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_status <> 'active' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = '23514';
  end if;
  if not exists (select 1 from public.clinics where id = p_clinic) then
    raise exception 'Clinic not found' using errcode = 'P0002';
  end if;
  perform set_config('vaidyora.platform_op', 'on', true);
  update public.clinics set status = p_status, status_reason = nullif(left(trim(p_reason), 500), '') where id = p_clinic;
  perform set_config('vaidyora.platform_op', 'off', true);
end;
$$;

create or replace function public.platform_assign_plan(
  p_clinic uuid,
  p_plan_code text,
  p_status public.subscription_status,
  p_period_end timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
begin
  if not private.is_platform_admin('owner') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select id into v_plan from public.subscription_plans where code = p_plan_code and is_active;
  if v_plan is null then
    raise exception 'Unknown plan' using errcode = 'P0002';
  end if;
  insert into public.tenant_subscriptions (clinic_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
  values (p_clinic, v_plan, p_status, case when p_status = 'trialing' then coalesce(p_period_end, now() + interval '14 days') end, now(), p_period_end)
  on conflict (clinic_id) do update set
    plan_id = excluded.plan_id, status = excluded.status, trial_ends_at = excluded.trial_ends_at,
    current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
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
grant execute on function private.in_branch_scope(uuid, uuid) to authenticated;
grant execute on function private.is_platform_admin(public.platform_role) to authenticated;
grant execute on function private.clinic_tz(uuid) to authenticated;
grant execute on function private.clinic_today(uuid) to authenticated;

revoke execute on function public.accept_invitation(uuid) from public, anon;
revoke execute on function public.platform_list_clinics() from public, anon;
revoke execute on function public.platform_set_clinic_status(uuid, public.clinic_status, text) from public, anon;
revoke execute on function public.platform_assign_plan(uuid, text, public.subscription_status, timestamptz) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.platform_list_clinics() to authenticated;
grant execute on function public.platform_set_clinic_status(uuid, public.clinic_status, text) to authenticated;
grant execute on function public.platform_assign_plan(uuid, text, public.subscription_status, timestamptz) to authenticated;
