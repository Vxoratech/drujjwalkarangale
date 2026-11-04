-- =============================================================================
-- Vaidyora — 0200 Access control: permissions, role templates, staff, branches
-- =============================================================================
-- Effective permissions
--   primary doctor  role 'primary_doctor' (the only holder of doctor_only keys)
--   admin           role 'admin'
--   staff           (template ∪ grants) − denies − doctor_only, while active
-- Branch scope: doctor and admin see every branch; staff see the branches in
-- staff_branch_assignments. Branch links are separate from permissions.
-- Guards: doctor_only keys can't be placed in any other role or override;
-- nobody edits their own access; staff grant only what they hold.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Catalogue
-- -----------------------------------------------------------------------------
create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module text not null check (module ~ '^[a-z_]+$'),
  action text not null check (action ~ '^[a-z_]+$'),
  label text not null check (char_length(label) between 2 and 80),
  description text not null check (char_length(description) <= 240),
  sensitivity public.permission_sensitivity not null default 'normal',
  doctor_only boolean not null default false,
  position smallint not null default 0,
  check (key = module || '.' || action),
  check (not doctor_only or sensitivity = 'clinical')
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text check (char_length(description) <= 300),
  -- 'account' roles back the primary doctor and admin accounts and are fixed
  -- by migrations; 'staff' roles are editable templates.
  scope text not null default 'staff' check (scope in ('account', 'staff')),
  is_system boolean not null default false,
  default_designation public.staff_designation,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (scope = 'staff' or key in ('primary_doctor', 'admin'))
);
create trigger roles_updated_at before update on public.roles
  for each row execute function private.set_updated_at();
create trigger roles_updated_by before update on public.roles
  for each row execute function private.set_updated_by();

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);
create index role_permissions_permission_idx on public.role_permissions (permission_key);

-- Doctor-only permissions belong to the primary doctor role and nowhere else.
create or replace function private.guard_role_permission()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_role public.roles;
begin
  select * into v_role from public.roles where id = coalesce(new.role_id, old.role_id);
  if v_role.scope = 'account' and current_user in ('authenticated', 'anon') then
    raise exception 'Account roles are fixed' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and v_role.key <> 'primary_doctor'
     and exists (select 1 from public.permissions p where p.key = new.permission_key and p.doctor_only) then
    raise exception 'Doctor-only permissions cannot be given to other roles' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function private.guard_role_permission();

-- -----------------------------------------------------------------------------
-- Staff
-- -----------------------------------------------------------------------------
create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.user_profiles (id) on delete set null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  mobile text check (mobile ~ '^\+?[0-9 -]{7,20}$'),
  designation public.staff_designation not null,
  designation_label text check (char_length(designation_label) <= 80),
  role_id uuid not null references public.roles (id),
  employee_code text unique check (employee_code ~ '^[A-Za-z0-9-]{1,20}$'),
  employment_type public.employment_type not null default 'full_time',
  joined_on date,
  status public.staff_status not null default 'invited',
  invited_at timestamptz,
  accepted_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text check (char_length(deactivation_reason) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (designation <> 'other' or designation_label is not null),
  check (status <> 'active' or (user_id is not null and accepted_at is not null)),
  check ((status = 'inactive') = (deactivated_at is not null))
);
create unique index staff_members_email_key on public.staff_members (lower(email));
create index staff_members_status_idx on public.staff_members (status);
create index staff_members_name_idx on public.staff_members (lower(full_name));
create trigger staff_members_updated_at before update on public.staff_members
  for each row execute function private.set_updated_at();
create trigger staff_members_updated_by before update on public.staff_members
  for each row execute function private.set_updated_by();
create trigger staff_members_no_delete before delete on public.staff_members
  for each row execute function private.immutable_row();

-- A staff record can only ever be linked to a 'staff' account, so staff
-- management can never mint or touch an admin or doctor identity.
create or replace function private.validate_staff_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and new.user_id is distinct from old.user_id then
    if tg_op = 'UPDATE' and old.user_id is not null then
      raise exception 'A staff record cannot be moved to another account' using errcode = '42501';
    end if;
    if not exists (select 1 from public.user_profiles p where p.id = new.user_id and p.account_type = 'staff') then
      raise exception 'Only staff accounts can be linked to staff records' using errcode = '42501';
    end if;
  end if;
  if exists (select 1 from public.roles r where r.id = new.role_id and r.scope <> 'staff') then
    raise exception 'Staff use staff role templates only' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger staff_members_validate_account before insert or update on public.staff_members
  for each row execute function private.validate_staff_account();

create table public.staff_branch_assignments (
  staff_id uuid not null references public.staff_members (id) on delete cascade,
  branch_id uuid not null references public.clinic_branches (id),
  assigned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (staff_id, branch_id)
);
create index staff_branch_assignments_branch_idx on public.staff_branch_assignments (branch_id);

create table public.staff_permission_overrides (
  staff_id uuid not null references public.staff_members (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  effect public.override_effect not null,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (staff_id, permission_key)
);

create or replace function private.guard_staff_override()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.permissions p where p.key = new.permission_key and p.doctor_only) then
    raise exception 'Doctor-only permissions cannot be given to staff' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger staff_permission_overrides_guard before insert or update on public.staff_permission_overrides
  for each row execute function private.guard_staff_override();

alter table public.clinic_branches
  add constraint clinic_branches_manager_fk foreign key (manager_staff_id) references public.staff_members (id) on delete set null;

create or replace function private.validate_branch_manager()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.manager_staff_id is not null and new.manager_staff_id is distinct from old.manager_staff_id and not exists (
    select 1 from public.staff_members s
    join public.staff_branch_assignments a on a.staff_id = s.id and a.branch_id = new.id
    where s.id = new.manager_staff_id and s.status <> 'inactive'
  ) then
    raise exception 'A branch manager must be a current staff member assigned to that branch' using errcode = '23514';
  end if;
  if not new.is_active and old.is_active and new.is_primary then
    raise exception 'The primary branch cannot be deactivated' using errcode = '23514';
  end if;
  -- Branch settings (without branches.manage) cover contact details only.
  if current_user in ('authenticated', 'anon') and not private.can('branches.manage')
     and (new.code, new.is_active, new.manager_staff_id) is distinct from (old.code, old.is_active, old.manager_staff_id) then
    raise exception 'Not permitted to change branch status, code or manager' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clinic_branches_validate_manager before update on public.clinic_branches
  for each row execute function private.validate_branch_manager();

create trigger roles_audit after insert or update or delete on public.roles
  for each row execute function private.audit_row();
create trigger role_permissions_audit after insert or delete on public.role_permissions
  for each row execute function private.audit_row();
create trigger staff_members_audit after insert or update on public.staff_members
  for each row execute function private.audit_row();
create trigger staff_branch_assignments_audit after insert or delete on public.staff_branch_assignments
  for each row execute function private.audit_row();
create trigger staff_permission_overrides_audit after insert or update or delete on public.staff_permission_overrides
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Permission evaluation
-- -----------------------------------------------------------------------------
-- The account type the caller currently acts as, or null when they have no
-- access (unknown user, deactivated account, invited or inactive staff).
create or replace function private.my_account()
returns public.account_type language sql stable security definer set search_path = '' as $$
  select case
    when p.account_type in ('primary_doctor', 'admin') then p.account_type
    when exists (select 1 from public.staff_members s where s.user_id = p.id and s.status = 'active') then 'staff'::public.account_type
  end
  from public.user_profiles p
  where p.id = auth.uid() and p.is_active;
$$;

create or replace function private.is_doctor()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_account() = 'primary_doctor', false);
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_account() = 'admin', false);
$$;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_account() is not null;
$$;

create or replace function private.my_staff_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.staff_members s
  join public.user_profiles p on p.id = s.user_id and p.is_active
  where s.user_id = auth.uid() and s.status = 'active';
$$;

create or replace function private.staff_permissions(p_staff uuid)
returns setof text language sql stable security definer set search_path = '' as $$
  select x.key from (
    select rp.permission_key as key
    from public.staff_members s join public.role_permissions rp on rp.role_id = s.role_id
    where s.id = p_staff
    union
    select o.permission_key from public.staff_permission_overrides o where o.staff_id = p_staff and o.effect = 'grant'
  ) x
  join public.permissions p on p.key = x.key and not p.doctor_only
  where not exists (
    select 1 from public.staff_permission_overrides d where d.staff_id = p_staff and d.permission_key = x.key and d.effect = 'deny'
  );
$$;

create or replace function private.my_permissions()
returns setof text language sql stable security definer set search_path = '' as $$
  select rp.permission_key
  from public.roles r join public.role_permissions rp on rp.role_id = r.id
  where r.scope = 'account' and r.key = private.my_account()::text
  union
  select k from private.staff_permissions(private.my_staff_id()) k;
$$;

create or replace function private.can(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.my_permissions() k where k = p_permission);
$$;

create or replace function private.has_all_branches()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_account() in ('primary_doctor', 'admin'), false);
$$;

create or replace function private.my_branch_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select b.id from public.clinic_branches b where private.has_all_branches()
  union
  select a.branch_id from public.staff_branch_assignments a where a.staff_id = private.my_staff_id();
$$;

create or replace function private.in_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_branch is not null and (
    private.has_all_branches()
    or exists (select 1 from public.staff_branch_assignments a where a.staff_id = private.my_staff_id() and a.branch_id = p_branch)
  );
$$;

create or replace function private.can_at(p_permission text, p_branch uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can(p_permission) and private.in_branch(p_branch);
$$;

-- Staff the caller may see: everyone for doctor/admin; otherwise staff who
-- share a branch with them, and always themselves.
create or replace function private.can_see_staff(p_staff uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_staff = private.my_staff_id()
      or (private.can('staff.view') and (
        private.has_all_branches()
        or exists (select 1 from public.staff_branch_assignments a
                   where a.staff_id = p_staff and a.branch_id in (select private.my_branch_ids()))));
$$;

-- Staff the caller may manage: never themselves; branch-scoped managers only
-- staff whose every branch is one of theirs.
create or replace function private.can_manage_staff(p_staff uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can('staff.manage')
     and p_staff is distinct from private.my_staff_id()
     and not exists (select 1 from public.staff_members s where s.id = p_staff and s.user_id = auth.uid())
     and (private.has_all_branches() or not exists (
       select 1 from public.staff_branch_assignments a
       where a.staff_id = p_staff and a.branch_id not in (select private.my_branch_ids())));
$$;

-- Permissions the caller may hand out. Doctor and admin may grant any
-- non-doctor-only permission; delegated staff managers only what they hold.
create or replace function private.can_grant(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.permissions p where p.key = p_permission and not p.doctor_only)
     and (private.has_all_branches() or private.can(p_permission));
$$;

-- -----------------------------------------------------------------------------
-- Permission catalogue and role templates (data; editable without schema change)
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module, action, label, description, sensitivity, doctor_only, position) values
  ('patients.view_basic',      'patients', 'view_basic',   'View basic patient information', 'Name, patient ID, contact details and visit list', 'normal', false, 10),
  ('patients.view_history',    'patients', 'view_history', 'View medical history', 'Allergies, chronic conditions, prakriti and past clinical records', 'clinical', false, 11),
  ('patients.create',          'patients', 'create',       'Register new patients', 'Create a patient profile after checking for duplicates', 'normal', false, 12),
  ('patients.edit_contact',    'patients', 'edit_contact', 'Edit patient contact information', 'Phone, email, address and emergency contact', 'normal', false, 13),
  ('patients.edit',            'patients', 'edit',         'Edit all patient details', 'Name, date of birth, gender and status', 'sensitive', false, 14),
  ('patients.delete',          'patients', 'delete',       'Archive patients', 'Mark a patient record inactive; records are retained', 'sensitive', false, 15),
  ('patients.export',          'patients', 'export',       'Export patient lists', 'Download or print patient lists', 'sensitive', false, 16),
  ('consents.manage',          'consents', 'manage',       'Record patient consents', 'Record and withdraw treatment and communication consents', 'normal', false, 20),
  ('appointments.view',        'appointments', 'view',     'View appointments', 'See the schedule of assigned branches', 'normal', false, 30),
  ('appointments.create',      'appointments', 'create',   'Book appointments', 'Book new appointments', 'normal', false, 31),
  ('appointments.reschedule',  'appointments', 'reschedule', 'Reschedule appointments', 'Change appointment times and branch', 'normal', false, 32),
  ('appointments.cancel',      'appointments', 'cancel',   'Cancel appointments', 'Cancel with a reason', 'normal', false, 33),
  ('appointments.update_status', 'appointments', 'update_status', 'Check patients in', 'Mark arrivals, no-shows and completion', 'normal', false, 34),
  ('consultations.view',       'consultations', 'view',    'View consultations', 'Read consultation notes and treatment plans', 'clinical', false, 40),
  ('consultations.create',     'consultations', 'create',  'Start consultations', 'Doctor only', 'clinical', true, 41),
  ('consultations.edit',       'consultations', 'edit',    'Edit and finalize consultations', 'Doctor only: notes, treatment plans, amendments', 'clinical', true, 42),
  ('examinations.view',        'examinations', 'view',     'View Ayurvedic examinations', 'Prakriti, vikriti, ashtavidha pariksha', 'clinical', false, 45),
  ('examinations.edit',        'examinations', 'edit',     'Record Ayurvedic examinations', 'Doctor only', 'clinical', true, 46),
  ('prescriptions.view',       'prescriptions', 'view',    'View prescriptions', 'Read issued prescriptions', 'clinical', false, 50),
  ('prescriptions.create',     'prescriptions', 'create',  'Write prescriptions', 'Doctor only: drafts, templates and revisions', 'clinical', true, 51),
  ('prescriptions.finalize',   'prescriptions', 'finalize', 'Issue prescriptions', 'Doctor only', 'clinical', true, 52),
  ('prescriptions.print',      'prescriptions', 'print',   'Print prescriptions', 'Reprint issued prescriptions for patients', 'clinical', false, 53),
  ('investigations.view',      'investigations', 'view',   'View investigations', 'Ordered tests and their results', 'clinical', false, 60),
  ('investigations.order',     'investigations', 'order',  'Order investigations', 'Doctor only', 'clinical', true, 61),
  ('investigations.upload',    'investigations', 'upload', 'Upload reports', 'Attach lab and imaging reports to patients', 'sensitive', false, 62),
  ('investigations.manage',    'investigations', 'manage', 'Track investigations', 'Update sample and result status', 'sensitive', false, 63),
  ('documents.view',           'documents', 'view',        'Open patient documents', 'Open uploaded reports and photos', 'clinical', false, 65),
  ('documents.delete',         'documents', 'delete',      'Remove patient documents', 'Remove a document with a reason; the file is retained', 'sensitive', false, 66),
  ('follow_ups.view',          'follow_ups', 'view',       'View follow-ups', 'Follow-ups due at assigned branches', 'normal', false, 70),
  ('follow_ups.manage',        'follow_ups', 'manage',     'Book follow-ups', 'Book or close follow-ups', 'normal', false, 71),
  ('billing.view',             'billing', 'view',          'View invoices', 'Invoices and payments at assigned branches', 'normal', false, 80),
  ('billing.create',           'billing', 'create',        'Create invoices', 'Create invoices', 'normal', false, 81),
  ('billing.void',             'billing', 'void',          'Void invoices', 'Void unpaid invoices with a reason', 'sensitive', false, 82),
  ('billing.export',           'billing', 'export',        'Export billing data', 'Print or download billing lists', 'sensitive', false, 83),
  ('payments.record',          'payments', 'record',       'Record payments', 'Record payments and print receipts', 'normal', false, 85),
  ('payments.refund',          'payments', 'refund',       'Record refunds', 'Refund against recorded payments', 'sensitive', false, 86),
  ('payments.reconcile',       'payments', 'reconcile',    'Reconcile payments', 'Match payments with bank and UPI settlements', 'sensitive', false, 87),
  ('reports.operational',      'reports', 'operational',   'Operational reports', 'Appointments, patients and branch activity', 'normal', false, 90),
  ('reports.financial',        'reports', 'financial',     'Financial reports', 'Collections, outstanding, refunds and payment methods', 'sensitive', false, 91),
  ('reports.clinical',         'reports', 'clinical',      'Clinical reports', 'Consultation and prescription activity', 'clinical', false, 92),
  ('staff.view',               'staff', 'view',            'View staff', 'See staff at assigned branches', 'normal', false, 100),
  ('staff.manage',             'staff', 'manage',          'Manage staff', 'Add, edit, activate and deactivate staff and their branches', 'sensitive', false, 101),
  ('staff.permissions',        'staff', 'permissions',     'Configure permissions', 'Change role templates and individual permissions', 'sensitive', false, 102),
  ('branches.manage',          'branches', 'manage',       'Manage branches', 'Add, edit, activate and deactivate branches', 'sensitive', false, 110),
  ('settings.branch',          'settings', 'branch',       'Branch settings', 'Contact details and working hours of assigned branches', 'sensitive', false, 111),
  ('settings.organization',    'settings', 'organization', 'Clinic settings', 'Organization profile, numbering, preferences and examination fields', 'sensitive', false, 112),
  ('audit.view',               'audit', 'view',            'View audit logs', 'Security and activity history of assigned branches', 'sensitive', false, 120);

insert into public.roles (key, name, description, scope, is_system, default_designation) values
  ('primary_doctor', 'Primary doctor', 'Dr. Ujjwal Karangale: full clinical access and staff administration', 'account', true, null),
  ('admin', 'Administrator', 'Clinic administration across all branches; read-only clinical access', 'account', true, null),
  ('receptionist', 'Receptionist', 'Front desk: registration, appointments and consents', 'staff', true, 'receptionist'),
  ('clinic_coordinator', 'Clinic Coordinator', 'Front desk plus follow-ups and report uploads', 'staff', true, 'clinic_coordinator'),
  ('accountant', 'Accountant', 'Billing, payments, refunds, reconciliation and financial reports', 'staff', true, 'accountant'),
  ('billing_executive', 'Billing Executive', 'Create invoices and record payments', 'staff', true, 'billing_executive'),
  ('assistant', 'Assistant', 'Check patients in and see the day''s schedule', 'staff', true, 'assistant'),
  ('branch_manager', 'Branch Manager', 'Runs assigned branches: schedule, billing, staff roster and branch reports', 'staff', true, 'branch_manager'),
  ('custom', 'Custom', 'No permissions until you add them', 'staff', true, 'other');

-- Doctor: everything except organization settings and money handling.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r, public.permissions p
where r.key = 'primary_doctor'
  and p.key not in ('settings.organization', 'billing.create', 'billing.void', 'billing.export',
                    'payments.record', 'payments.refund', 'payments.reconcile', 'reports.financial');

-- Admin: everything that is not doctor-only.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r, public.permissions p
where r.key = 'admin' and not p.doctor_only;

insert into public.role_permissions (role_id, permission_key)
select r.id, k.key from public.roles r
join (values
  ('receptionist', 'patients.view_basic'), ('receptionist', 'patients.create'), ('receptionist', 'patients.edit_contact'),
  ('receptionist', 'consents.manage'), ('receptionist', 'appointments.view'), ('receptionist', 'appointments.create'),
  ('receptionist', 'appointments.reschedule'), ('receptionist', 'appointments.cancel'), ('receptionist', 'appointments.update_status'),
  ('receptionist', 'follow_ups.view'), ('receptionist', 'reports.operational'),

  ('clinic_coordinator', 'patients.view_basic'), ('clinic_coordinator', 'patients.create'), ('clinic_coordinator', 'patients.edit_contact'),
  ('clinic_coordinator', 'consents.manage'), ('clinic_coordinator', 'appointments.view'), ('clinic_coordinator', 'appointments.create'),
  ('clinic_coordinator', 'appointments.reschedule'), ('clinic_coordinator', 'appointments.cancel'), ('clinic_coordinator', 'appointments.update_status'),
  ('clinic_coordinator', 'follow_ups.view'), ('clinic_coordinator', 'follow_ups.manage'), ('clinic_coordinator', 'investigations.upload'),
  ('clinic_coordinator', 'reports.operational'), ('clinic_coordinator', 'staff.view'),

  ('accountant', 'billing.view'), ('accountant', 'billing.create'), ('accountant', 'billing.void'), ('accountant', 'billing.export'),
  ('accountant', 'payments.record'), ('accountant', 'payments.refund'), ('accountant', 'payments.reconcile'), ('accountant', 'reports.financial'),

  ('billing_executive', 'billing.view'), ('billing_executive', 'billing.create'), ('billing_executive', 'payments.record'),

  ('assistant', 'patients.view_basic'), ('assistant', 'appointments.view'), ('assistant', 'appointments.update_status'),
  ('assistant', 'follow_ups.view'),

  ('branch_manager', 'patients.view_basic'), ('branch_manager', 'patients.create'), ('branch_manager', 'patients.edit_contact'),
  ('branch_manager', 'patients.edit'), ('branch_manager', 'consents.manage'), ('branch_manager', 'appointments.view'),
  ('branch_manager', 'appointments.create'), ('branch_manager', 'appointments.reschedule'), ('branch_manager', 'appointments.cancel'),
  ('branch_manager', 'appointments.update_status'), ('branch_manager', 'follow_ups.view'), ('branch_manager', 'follow_ups.manage'),
  ('branch_manager', 'billing.view'), ('branch_manager', 'billing.create'), ('branch_manager', 'payments.record'),
  ('branch_manager', 'reports.operational'), ('branch_manager', 'reports.financial'), ('branch_manager', 'staff.view'),
  ('branch_manager', 'settings.branch')
) as k (role, key) on k.role = r.key;

-- -----------------------------------------------------------------------------
-- Caller's access (the UI shapes navigation from this; RLS enforces)
-- -----------------------------------------------------------------------------
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.my_account() is null then
    jsonb_build_object('account_type', null, 'reason', case
      when p.id is null then 'no_profile'
      when not p.is_active then 'deactivated'
      when exists (select 1 from public.staff_members s where s.user_id = p.id and s.status = 'invited') then 'invited'
      when exists (select 1 from public.staff_members s where s.user_id = p.id and s.status = 'inactive') then 'deactivated'
      else 'no_access' end)
  else jsonb_build_object(
    'account_type', private.my_account(),
    'user_id', p.id,
    'full_name', p.full_name,
    'email', p.email,
    'staff_id', private.my_staff_id(),
    'designation', (select s.designation from public.staff_members s where s.id = private.my_staff_id()),
    'designation_label', (select s.designation_label from public.staff_members s where s.id = private.my_staff_id()),
    'permissions', coalesce((select jsonb_agg(k order by k) from private.my_permissions() k), '[]'),
    'all_branches', private.has_all_branches(),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name, 'is_primary', b.is_primary) order by b.is_primary desc, b.name)
      from public.clinic_branches b where b.is_active and b.id in (select private.my_branch_ids())), '[]')
  ) end
  from (select auth.uid() as uid) me
  left join public.user_profiles p on p.id = me.uid;
$$;

-- -----------------------------------------------------------------------------
-- Trusted setup: bind the primary doctor and the first admin (service role /
-- SQL editor only — never callable from the app)
-- -----------------------------------------------------------------------------
create or replace function public.bootstrap_primary_doctor(p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if exists (select 1 from public.organization where primary_doctor_id is not null) then
    raise exception 'The primary doctor is already set' using errcode = '42501';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'Create the auth user first' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.staff_members s where s.user_id = v_user) then
    raise exception 'This account belongs to a staff member' using errcode = '42501';
  end if;
  perform set_config('vaidyora.identity_op', 'on', true);
  update public.user_profiles set account_type = 'primary_doctor', is_active = true where id = v_user;
  update public.organization set primary_doctor_id = v_user;
  perform set_config('vaidyora.identity_op', 'off', true);
  perform private.log_event('identity.primary_doctor_bound', 'security', 'user_profiles', v_user);
  return v_user;
end;
$$;

-- Turns an invited auth account into an admin. Called by the staff-admin Edge
-- Function only after it has checked that the caller is the primary doctor.
create or replace function public.link_admin_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.staff_members s where s.user_id = p_user) then
    raise exception 'This account belongs to a staff member' using errcode = '42501';
  end if;
  perform set_config('vaidyora.identity_op', 'on', true);
  update public.user_profiles set account_type = 'admin', is_active = true
   where id = p_user and account_type in ('staff', 'admin');
  if not found then
    perform set_config('vaidyora.identity_op', 'off', true);
    raise exception 'This account cannot become an administrator' using errcode = '42501';
  end if;
  perform set_config('vaidyora.identity_op', 'off', true);
end;
$$;

-- The primary doctor activates or deactivates administrators.
create or replace function public.set_admin_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_doctor() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform set_config('vaidyora.identity_op', 'on', true);
  update public.user_profiles set is_active = p_active where id = p_user and account_type = 'admin';
  if not found then
    perform set_config('vaidyora.identity_op', 'off', true);
    raise exception 'Administrator not found' using errcode = 'P0002';
  end if;
  perform set_config('vaidyora.identity_op', 'off', true);
end;
$$;

-- Links an invited auth account to its staff record (service role only).
create or replace function public.link_staff_account(p_staff uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.staff_members;
begin
  select * into s from public.staff_members where id = p_staff for update;
  if not found then
    raise exception 'Staff member not found' using errcode = 'P0002';
  end if;
  if s.user_id = p_user then
    update public.staff_members set invited_at = now() where id = p_staff;
    return;
  end if;
  if s.user_id is not null or s.status <> 'invited' then
    raise exception 'This staff record is already linked' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user and lower(u.email) = lower(s.email)) then
    raise exception 'The account email does not match the staff record' using errcode = '42501';
  end if;
  update public.staff_members set user_id = p_user, invited_at = now() where id = p_staff;
  update public.user_profiles set full_name = s.full_name, phone = coalesce(phone, s.mobile)
   where id = p_user and full_name = '';
end;
$$;

create or replace function public.find_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Staff management (Admin, Doctor, or staff with delegated authority)
-- -----------------------------------------------------------------------------
create or replace function private.validate_branch_list(p_branches uuid[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(cardinality(p_branches), 0) = 0 then
    raise exception 'Assign at least one branch' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(p_branches) b where not exists (select 1 from public.clinic_branches c where c.id = b and c.is_active)) then
    raise exception 'Unknown or inactive branch' using errcode = '23503';
  end if;
  if exists (select 1 from unnest(p_branches) b where not private.in_branch(b)) then
    raise exception 'You can only assign branches you manage' using errcode = '42501';
  end if;
end;
$$;

-- Validates a template + overrides set against the grantor's authority and
-- returns the overrides as rows.
create or replace function private.validate_access(p_role uuid, p_overrides jsonb)
returns table (permission_key text, effect public.override_effect)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.roles r where r.id = p_role and r.scope = 'staff') then
    raise exception 'Choose a staff role template' using errcode = '23503';
  end if;
  if p_overrides is not null and jsonb_typeof(p_overrides) <> 'object' then
    raise exception 'Invalid permission overrides' using errcode = '22023';
  end if;
  return query
  select o.key, (o.value #>> '{}')::public.override_effect
  from jsonb_each(coalesce(p_overrides, '{}')) o;
  if exists (select 1 from jsonb_each(coalesce(p_overrides, '{}')) o where not exists (select 1 from public.permissions p where p.key = o.key)) then
    raise exception 'Unknown permission' using errcode = '23503';
  end if;
  if exists (
    select 1 from (
      select rp.permission_key as key from public.role_permissions rp where rp.role_id = p_role
      union
      select o.key from jsonb_each(coalesce(p_overrides, '{}')) o where o.value #>> '{}' = 'grant'
    ) g where not private.can_grant(g.key)
  ) then
    raise exception 'You can only grant permissions within your own authority' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_staff_member(p_profile jsonb, p_role uuid, p_branches uuid[], p_overrides jsonb default '{}')
returns public.staff_members language plpgsql security definer set search_path = '' as $$
declare
  v_row public.staff_members;
  v_email text := lower(trim(p_profile ->> 'email'));
begin
  if not private.can('staff.manage') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if coalesce(p_overrides, '{}') <> '{}' and not private.can('staff.permissions') then
    raise exception 'Not permitted to customise permissions' using errcode = '42501';
  end if;
  perform private.validate_branch_list(p_branches);
  perform 1 from private.validate_access(p_role, p_overrides);
  if exists (select 1 from public.user_profiles p where lower(p.email) = v_email and p.account_type <> 'staff') then
    raise exception 'This email belongs to the doctor or an administrator' using errcode = '23505';
  end if;

  insert into public.staff_members (full_name, email, mobile, designation, designation_label, role_id,
    employee_code, employment_type, joined_on, created_by)
  values (
    trim(p_profile ->> 'full_name'), v_email, nullif(trim(p_profile ->> 'mobile'), ''),
    (p_profile ->> 'designation')::public.staff_designation, nullif(trim(p_profile ->> 'designation_label'), ''), p_role,
    nullif(trim(p_profile ->> 'employee_code'), ''),
    coalesce((p_profile ->> 'employment_type')::public.employment_type, 'full_time'),
    (p_profile ->> 'joined_on')::date, auth.uid())
  returning * into v_row;

  insert into public.staff_branch_assignments (staff_id, branch_id, assigned_by)
  select v_row.id, b, auth.uid() from (select distinct unnest(p_branches) as b) x;
  insert into public.staff_permission_overrides (staff_id, permission_key, effect, granted_by)
  select v_row.id, a.permission_key, a.effect, auth.uid() from private.validate_access(p_role, p_overrides) a;

  perform private.log_event('staff.created', 'permission', 'staff_members', v_row.id, '{}', jsonb_build_object(
    'role_id', p_role, 'branches', to_jsonb(p_branches),
    'permissions', coalesce((select jsonb_agg(k order by k) from private.staff_permissions(v_row.id) k), '[]')));
  return v_row;
end;
$$;

create or replace function public.update_staff_member(p_staff uuid, p_profile jsonb)
returns public.staff_members language plpgsql security definer set search_path = '' as $$
declare
  v_row public.staff_members;
begin
  select * into v_row from public.staff_members where id = p_staff for update;
  if not found or not private.can_manage_staff(p_staff) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.staff_members set
    full_name = coalesce(nullif(trim(p_profile ->> 'full_name'), ''), full_name),
    -- the email is the login, so it is fixed once the invitation is linked
    email = case when user_id is null then coalesce(lower(nullif(trim(p_profile ->> 'email'), '')), email) else email end,
    mobile = case when p_profile ? 'mobile' then nullif(trim(p_profile ->> 'mobile'), '') else mobile end,
    designation = coalesce((p_profile ->> 'designation')::public.staff_designation, designation),
    designation_label = case when p_profile ? 'designation_label' then nullif(trim(p_profile ->> 'designation_label'), '') else designation_label end,
    employee_code = case when p_profile ? 'employee_code' then nullif(trim(p_profile ->> 'employee_code'), '') else employee_code end,
    employment_type = coalesce((p_profile ->> 'employment_type')::public.employment_type, employment_type),
    joined_on = case when p_profile ? 'joined_on' then (p_profile ->> 'joined_on')::date else joined_on end
  where id = p_staff
  returning * into v_row;
  return v_row;
end;
$$;

-- Replaces a staff member's template and overrides in one audited change.
create or replace function public.set_staff_access(p_staff uuid, p_role uuid, p_overrides jsonb)
returns public.staff_members language plpgsql security definer set search_path = '' as $$
declare
  v_row public.staff_members;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_row from public.staff_members where id = p_staff for update;
  if not found or not private.can_manage_staff(p_staff) or not private.can('staff.permissions') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform 1 from private.validate_access(p_role, p_overrides);
  v_before := coalesce((select jsonb_agg(k order by k) from private.staff_permissions(p_staff) k), '[]');

  update public.staff_members set role_id = p_role where id = p_staff returning * into v_row;
  delete from public.staff_permission_overrides where staff_id = p_staff;
  insert into public.staff_permission_overrides (staff_id, permission_key, effect, granted_by)
  select p_staff, a.permission_key, a.effect, auth.uid() from private.validate_access(p_role, p_overrides) a;

  v_after := coalesce((select jsonb_agg(k order by k) from private.staff_permissions(p_staff) k), '[]');
  perform private.log_event('staff.permissions_changed', 'permission', 'staff_members', p_staff, '{}', jsonb_build_object(
    'role_id', p_role,
    'granted', coalesce((select jsonb_agg(x order by x) from jsonb_array_elements_text(v_after) x where not v_before ? x), '[]'),
    'revoked', coalesce((select jsonb_agg(x order by x) from jsonb_array_elements_text(v_before) x where not v_after ? x), '[]')));
  return v_row;
end;
$$;

create or replace function public.set_staff_branches(p_staff uuid, p_branches uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before uuid[];
begin
  perform 1 from public.staff_members where id = p_staff for update;
  if not found or not private.can_manage_staff(p_staff) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.validate_branch_list(p_branches);
  select coalesce(array_agg(branch_id order by branch_id), '{}') into v_before from public.staff_branch_assignments where staff_id = p_staff;
  delete from public.staff_branch_assignments where staff_id = p_staff and branch_id <> all (p_branches);
  insert into public.staff_branch_assignments (staff_id, branch_id, assigned_by)
  select p_staff, b, auth.uid() from (select distinct unnest(p_branches) as b) x
  on conflict do nothing;
  update public.clinic_branches set manager_staff_id = null where manager_staff_id = p_staff and id <> all (p_branches);
  perform private.log_event('staff.branches_changed', 'permission', 'staff_members', p_staff, '{}',
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(p_branches)));
end;
$$;

create or replace function public.set_staff_status(p_staff uuid, p_status public.staff_status, p_reason text default null)
returns public.staff_members language plpgsql security definer set search_path = '' as $$
declare
  v_row public.staff_members;
begin
  select * into v_row from public.staff_members where id = p_staff for update;
  if not found or not private.can_manage_staff(p_staff) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_status = 'invited' then
    raise exception 'Use Resend invitation instead' using errcode = '22023';
  end if;
  if p_status = 'active' and v_row.accepted_at is null then
    raise exception 'The staff member has not accepted the invitation yet' using errcode = '23514';
  end if;
  if p_status = 'inactive' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to deactivate access' using errcode = '23514';
  end if;
  update public.staff_members set
    status = p_status,
    deactivated_at = case when p_status = 'inactive' then now() end,
    deactivation_reason = case when p_status = 'inactive' then left(trim(p_reason), 300) end
  where id = p_staff
  returning * into v_row;
  if p_status = 'inactive' then
    update public.clinic_branches set manager_staff_id = null where manager_staff_id = p_staff;
  end if;
  return v_row;
end;
$$;

-- Lets the staff-admin Edge Function confirm the caller's authority before
-- it uses the service role.
create or replace function public.can_manage_staff_member(p_staff uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_members s where s.id = p_staff) and private.can_manage_staff(p_staff);
$$;

create or replace function public.accept_staff_invitation()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.staff_members set status = 'active', accepted_at = now()
   where user_id = auth.uid() and status = 'invited';
  if not found then
    raise exception 'No pending invitation' using errcode = 'P0002';
  end if;
end;
$$;

-- What a staff member can do and why (template, grant, deny) — for the editor.
create or replace function public.staff_permission_matrix(p_staff uuid)
returns table (permission_key text, in_template boolean, override public.override_effect, effective boolean, grantable boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_see_staff(p_staff) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select p.key,
         exists (select 1 from public.staff_members s join public.role_permissions rp on rp.role_id = s.role_id
                 where s.id = p_staff and rp.permission_key = p.key),
         (select o.effect from public.staff_permission_overrides o where o.staff_id = p_staff and o.permission_key = p.key),
         p.key in (select private.staff_permissions(p_staff)),
         private.can_grant(p.key)
  from public.permissions p
  order by p.position;
end;
$$;

-- Role templates (staff scope only).
create or replace function public.save_role_template(p_id uuid, p_key text, p_name text, p_description text, p_permissions text[])
returns public.roles language plpgsql security definer set search_path = '' as $$
declare
  v_row public.roles;
  v_before jsonb;
begin
  if not private.can('staff.permissions') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_permissions, '{}')) k where not private.can_grant(k)) then
    raise exception 'You can only grant permissions within your own authority' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.roles (key, name, description, scope)
    values (p_key, trim(p_name), nullif(trim(p_description), ''), 'staff') returning * into v_row;
    v_before := '[]';
  else
    select * into v_row from public.roles where id = p_id and scope = 'staff' for update;
    if not found then
      raise exception 'Role template not found' using errcode = 'P0002';
    end if;
    v_before := coalesce((select jsonb_agg(permission_key order by permission_key) from public.role_permissions where role_id = p_id), '[]');
    update public.roles set name = trim(p_name), description = nullif(trim(p_description), '') where id = p_id returning * into v_row;
  end if;
  delete from public.role_permissions where role_id = v_row.id and permission_key <> all (coalesce(p_permissions, '{}'));
  insert into public.role_permissions (role_id, permission_key)
  select v_row.id, k from (select distinct unnest(coalesce(p_permissions, '{}')) as k) x on conflict do nothing;
  perform private.log_event('roles.permissions_changed', 'permission', 'roles', v_row.id, '{}', jsonb_build_object(
    'before', v_before,
    'after', coalesce((select jsonb_agg(permission_key order by permission_key) from public.role_permissions where role_id = v_row.id), '[]'),
    'staff_affected', (select count(*) from public.staff_members s where s.role_id = v_row.id and s.status <> 'inactive')));
  return v_row;
end;
$$;

create or replace function public.delete_role_template(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can('staff.permissions') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.roles where id = p_id and (is_system or scope <> 'staff')) then
    raise exception 'Built-in templates cannot be deleted' using errcode = '42501';
  end if;
  if exists (select 1 from public.staff_members where role_id = p_id) then
    raise exception 'Move staff to another template first' using errcode = '23503';
  end if;
  delete from public.roles where id = p_id and scope = 'staff' and not is_system;
end;
$$;

-- Last activity per staff account (for the staff list), from the audit trail.
create or replace function public.staff_last_activity()
returns table (staff_id uuid, last_activity_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can('staff.view') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select s.id,
         (select max(e.created_at) from public.audit_events e where e.actor_id = s.user_id),
         (select max(e.created_at) from public.audit_events e where e.actor_id = s.user_id and e.event_type = 'session.signed_in')
  from public.staff_members s
  where s.user_id is not null and private.can_see_staff(s.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Branch working hours (replace a branch's week in one call)
-- -----------------------------------------------------------------------------
create or replace function public.set_branch_hours(p_branch uuid, p_hours jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.can('branches.manage') or private.can_at('settings.branch', p_branch)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_hours, '[]')) <> 'array' or jsonb_array_length(coalesce(p_hours, '[]')) > 28 then
    raise exception 'Invalid working hours' using errcode = '22023';
  end if;
  delete from public.branch_working_hours where branch_id = p_branch;
  insert into public.branch_working_hours (branch_id, weekday, opens_at, closes_at, slot_minutes)
  select p_branch, (h ->> 'weekday')::smallint, (h ->> 'opens_at')::time, (h ->> 'closes_at')::time,
         coalesce((h ->> 'slot_minutes')::smallint, 15)
  from jsonb_array_elements(coalesce(p_hours, '[]')) h;
  if exists (
    select 1 from public.branch_working_hours a join public.branch_working_hours b
      on a.branch_id = b.branch_id and a.weekday = b.weekday and a.id < b.id
     and a.opens_at < b.closes_at and b.opens_at < a.closes_at
    where a.branch_id = p_branch
  ) then
    raise exception 'Working hours overlap on the same day' using errcode = '23514';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Session events reported by the client (sign-in, sign-out)
-- -----------------------------------------------------------------------------
create or replace function public.log_session_event(p_event text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_event not in ('session.signed_in', 'session.signed_out') then
    raise exception 'Unknown session event' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.log_event(p_event, 'security', 'session', auth.uid(), '{}', jsonb_build_object('client_reported', true));
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_members enable row level security;
alter table public.staff_branch_assignments enable row level security;
alter table public.staff_permission_overrides enable row level security;

create policy user_profiles_select on public.user_profiles for select to authenticated
  using (id = auth.uid() or (select private.is_active_user()));
create policy user_profiles_update_own on public.user_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy organization_select on public.organization for select to authenticated
  using ((select private.is_active_user()));
create policy organization_update on public.organization for update to authenticated
  using ((select private.can('settings.organization'))) with check ((select private.can('settings.organization')));

create policy clinic_settings_select on public.clinic_settings for select to authenticated
  using ((select private.is_active_user()));
create policy clinic_settings_update on public.clinic_settings for update to authenticated
  using ((select private.can('settings.organization'))) with check ((select private.can('settings.organization')));

create policy clinic_branches_select on public.clinic_branches for select to authenticated
  using ((select private.is_active_user()));
create policy clinic_branches_insert on public.clinic_branches for insert to authenticated
  with check ((select private.can('branches.manage')) and not is_primary);
create policy clinic_branches_update on public.clinic_branches for update to authenticated
  using ((select private.can('branches.manage')) or private.can_at('settings.branch', id))
  with check ((select private.can('branches.manage')) or private.can_at('settings.branch', id));

create policy branch_working_hours_select on public.branch_working_hours for select to authenticated
  using ((select private.is_active_user()));

create policy permissions_select on public.permissions for select to authenticated
  using ((select private.is_active_user()));
create policy roles_select on public.roles for select to authenticated
  using ((select private.is_active_user()));
create policy role_permissions_select on public.role_permissions for select to authenticated
  using ((select private.is_active_user()));

create policy staff_members_select on public.staff_members for select to authenticated
  using (user_id = auth.uid() or private.can_see_staff(id));
create policy staff_branch_assignments_select on public.staff_branch_assignments for select to authenticated
  using (private.can_see_staff(staff_id));
create policy staff_permission_overrides_select on public.staff_permission_overrides for select to authenticated
  using (private.can_see_staff(staff_id));

-- Audit: doctor and admin see everything; staff with audit.view see events
-- at their branches and their own actions.
create policy audit_events_select on public.audit_events for select to authenticated
  using ((select private.can('audit.view')) and (
    (select private.has_all_branches()) or actor_id = auth.uid() or private.in_branch(branch_id)));

-- -----------------------------------------------------------------------------
-- Grants (RLS still applies). Writes to staff and access tables go through
-- the functions above, never directly.
-- -----------------------------------------------------------------------------
revoke all on public.user_profiles, public.organization, public.clinic_settings, public.clinic_branches,
  public.branch_working_hours, public.audit_events, public.permissions, public.roles, public.role_permissions,
  public.staff_members, public.staff_branch_assignments, public.staff_permission_overrides from anon, authenticated;
grant select on public.user_profiles, public.organization, public.clinic_settings, public.clinic_branches,
  public.branch_working_hours, public.audit_events, public.permissions, public.roles, public.role_permissions,
  public.staff_members, public.staff_branch_assignments, public.staff_permission_overrides to authenticated;
grant update (full_name, phone, preferred_locale, qualification, medical_registration_no, signature_path) on public.user_profiles to authenticated;
grant update (name, legal_name, phone, email, address_line, city, state, pincode, gstin, registration_no, logo_path) on public.organization to authenticated;
grant update (timezone, default_locale, invoice_prefix, consultation_fee_paise, brand_accent, prescription_footer,
  audit_retention_days, preferences) on public.clinic_settings to authenticated;
grant insert (code, name, address_line, city, state, pincode, phone, email, is_active) on public.clinic_branches to authenticated;
grant update (code, name, address_line, city, state, pincode, phone, email, is_active, manager_staff_id) on public.clinic_branches to authenticated;

revoke execute on all functions in schema private from public;
grant execute on function private.my_account(), private.is_doctor(), private.is_admin(), private.is_active_user(),
  private.my_staff_id(), private.my_permissions(), private.can(text), private.has_all_branches(), private.my_branch_ids(),
  private.in_branch(uuid), private.can_at(text, uuid), private.can_see_staff(uuid), private.can_manage_staff(uuid),
  private.can_grant(text), private.staff_permissions(uuid), private.org_id(), private.org_tz(), private.org_today(),
  private.identity_op() to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_access(), public.set_admin_active(uuid, boolean),
  public.create_staff_member(jsonb, uuid, uuid[], jsonb), public.update_staff_member(uuid, jsonb),
  public.set_staff_access(uuid, uuid, jsonb), public.set_staff_branches(uuid, uuid[]),
  public.set_staff_status(uuid, public.staff_status, text), public.accept_staff_invitation(), public.can_manage_staff_member(uuid),
  public.staff_permission_matrix(uuid), public.save_role_template(uuid, text, text, text, text[]),
  public.delete_role_template(uuid), public.staff_last_activity(), public.set_branch_hours(uuid, jsonb),
  public.log_session_event(text) to authenticated;
grant execute on function public.bootstrap_primary_doctor(text), public.link_admin_account(uuid),
  public.link_staff_account(uuid, uuid), public.find_user_id_by_email(text), public.consume_rate_limit(text, integer, integer)
  to service_role;
