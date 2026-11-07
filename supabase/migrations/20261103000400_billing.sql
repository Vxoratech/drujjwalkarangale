-- =============================================================================
-- Vaidyora — 0400 Billing: invoices, payments, refunds
-- =============================================================================
-- Money is integer paise. Invoices belong to a branch; every money movement
-- goes through a SECURITY DEFINER function that locks the invoice, checks the
-- permission at that branch and is idempotent on a client request key.
-- =============================================================================

create type public.invoice_status as enum ('issued', 'partially_paid', 'paid', 'void', 'refunded');
create type public.invoice_item_type as enum ('consultation', 'procedure', 'panchakarma', 'medicine', 'investigation', 'other');
create type public.payment_method as enum ('cash', 'upi', 'card', 'bank_transfer', 'other');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  branch_id uuid not null references public.clinic_branches (id),
  patient_id uuid not null references public.patients (id),
  appointment_id uuid references public.appointments (id),
  status public.invoice_status not null default 'issued',
  issue_date date not null,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  amount_paid_paise bigint not null default 0 check (amount_paid_paise >= 0),
  amount_refunded_paise bigint not null default 0 check (amount_refunded_paise >= 0),
  notes text check (char_length(notes) <= 1000),
  void_reason text check (char_length(void_reason) <= 500),
  idempotency_key uuid unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (total_paise = subtotal_paise + tax_paise - discount_paise),
  check (amount_paid_paise <= total_paise),
  constraint invoices_refund_le_paid check (amount_refunded_paise <= amount_paid_paise),
  check (status <> 'void' or void_reason is not null)
);
create index invoices_branch_date_idx on public.invoices (branch_id, issue_date desc);
create index invoices_date_idx on public.invoices (issue_date desc);
create index invoices_patient_idx on public.invoices (patient_id);
create index invoices_outstanding_idx on public.invoices (branch_id) where status in ('issued', 'partially_paid');
create trigger invoices_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();
create trigger invoices_updated_by before update on public.invoices
  for each row execute function private.set_updated_by();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function private.audit_row();

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  position smallint not null default 0,
  item_type public.invoice_item_type not null default 'other',
  description text not null check (char_length(description) between 1 and 200),
  quantity numeric(10, 2) not null check (quantity > 0 and quantity <= 10000),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 28),
  line_total_paise bigint not null check (line_total_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0)
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id),
  patient_id uuid not null references public.patients (id),
  receipt_no text not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  method public.payment_method not null,
  reference text check (char_length(reference) <= 80),
  notes text check (char_length(notes) <= 500),
  paid_at timestamptz not null default now(),
  received_by uuid references auth.users (id) on delete set null,
  settlement_reference text check (char_length(settlement_reference) <= 80),
  reconciliation_note text check (char_length(reconciliation_note) <= 300),
  reconciled_at timestamptz,
  reconciled_by uuid references auth.users (id) on delete set null,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(),
  check ((reconciled_at is null) = (reconciled_by is null))
);
create index payments_paid_idx on public.payments (paid_at desc);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_unreconciled_idx on public.payments (paid_at) where reconciled_at is null;

create or replace function private.payments_guard()
returns trigger language plpgsql set search_path = '' as $$
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
create trigger payments_immutable before delete on public.payments
  for each row execute function private.immutable_row();
create trigger payments_audit after insert or update on public.payments
  for each row execute function private.audit_row();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id),
  payment_id uuid references public.payments (id),
  refund_no text not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  method public.payment_method not null,
  reference text check (char_length(reference) <= 80),
  reason text not null check (char_length(reason) between 1 and 500),
  refunded_at timestamptz not null default now(),
  refunded_by uuid references auth.users (id) on delete set null,
  idempotency_key uuid unique,
  created_at timestamptz not null default now()
);
create index refunds_date_idx on public.refunds (refunded_at desc);
create index refunds_invoice_idx on public.refunds (invoice_id);
create trigger refunds_immutable before update or delete on public.refunds
  for each row execute function private.immutable_row();
create trigger refunds_audit after insert on public.refunds
  for each row execute function private.audit_row();

-- Billing staff may see the basic profile of patients they bill at their
-- branches, even without patients.view_basic.
create or replace function private.can_see_patient(p_patient uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return private.can('patients.view_basic')
      or (private.can('billing.view') and exists (
            select 1 from public.invoices i where i.patient_id = p_patient and private.in_branch(i.branch_id)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Money functions
-- -----------------------------------------------------------------------------
create or replace function public.create_invoice(p_patient uuid, p_items jsonb, p_discount_paise bigint default 0,
  p_notes text default null, p_appointment uuid default null, p_branch uuid default null, p_idempotency_key uuid default null)
returns public.invoices language plpgsql security definer set search_path = '' as $$
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
  v_branch uuid := p_branch;
begin
  -- Idempotent retry: the same key returns the invoice it created.
  if p_idempotency_key is not null then
    select * into v_invoice from public.invoices where idempotency_key = p_idempotency_key;
    if found then
      if v_invoice.patient_id <> p_patient or not private.can_at('billing.create', v_invoice.branch_id) then
        raise exception 'This request key was already used for a different invoice' using errcode = '23505';
      end if;
      return v_invoice;
    end if;
  end if;
  if v_branch is null and p_appointment is not null then
    select a.branch_id into v_branch from public.appointments a where a.id = p_appointment and a.patient_id = p_patient;
  end if;
  v_branch := coalesce(v_branch, private.primary_branch());
  if not private.can_at('billing.create', v_branch) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.patients p where p.id = p_patient) then
    raise exception 'Patient not found' using errcode = 'P0002';
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

  insert into public.invoices (branch_id, patient_id, appointment_id, invoice_no, issue_date,
    subtotal_paise, tax_paise, discount_paise, total_paise, notes, created_by, idempotency_key)
  values (v_branch, p_patient, p_appointment,
    (select invoice_prefix from public.clinic_settings) || '-' || to_char(now() at time zone private.org_tz(), 'YYYY') || '-'
      || lpad(private.next_number('invoice')::text, 6, '0'),
    private.org_today(), 0, 0, 0, 0, nullif(trim(p_notes), ''), auth.uid(), p_idempotency_key)
  returning * into v_invoice;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price_paise')::bigint;
    v_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    if v_qty is null or v_price is null then
      raise exception 'Each line item needs a quantity and unit price' using errcode = '23514';
    end if;
    v_line := round(v_qty * v_price);
    v_tax := round(v_line * v_rate / 100);
    insert into public.invoice_items (invoice_id, position, item_type, description, quantity, unit_price_paise, tax_rate, line_total_paise, tax_paise)
    values (v_invoice.id, v_pos, coalesce((v_item ->> 'item_type')::public.invoice_item_type, 'other'),
            trim(v_item ->> 'description'), v_qty, v_price, v_rate, v_line, v_tax);
    v_pos := v_pos + 1;
    v_subtotal := v_subtotal + v_line;
    v_tax_total := v_tax_total + v_tax;
  end loop;

  if coalesce(p_discount_paise, 0) > v_subtotal + v_tax_total then
    raise exception 'Discount cannot exceed the invoice amount' using errcode = '23514';
  end if;

  update public.invoices
     set subtotal_paise = v_subtotal, tax_paise = v_tax_total, discount_paise = coalesce(p_discount_paise, 0),
         total_paise = v_subtotal + v_tax_total - coalesce(p_discount_paise, 0),
         status = case when v_subtotal + v_tax_total - coalesce(p_discount_paise, 0) = 0
                       then 'paid'::public.invoice_status else 'issued'::public.invoice_status end
   where id = v_invoice.id
   returning * into v_invoice;
  return v_invoice;
end;
$$;

create or replace function public.record_payment(p_invoice uuid, p_amount_paise bigint, p_method public.payment_method,
  p_reference text default null, p_paid_at timestamptz default now(), p_notes text default null, p_idempotency_key uuid default null)
returns public.payments language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices;
  v_payment public.payments;
  v_paid bigint;
begin
  select * into v_invoice from public.invoices where id = p_invoice for update;
  if not found or not private.can_at('payments.record', v_invoice.branch_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select * into v_payment from public.payments where idempotency_key = p_idempotency_key;
    if found then
      if v_payment.invoice_id <> v_invoice.id or v_payment.amount_paise <> p_amount_paise then
        raise exception 'This request key was already used for a different payment' using errcode = '23505';
      end if;
      return v_payment;
    end if;
  end if;
  if v_invoice.status not in ('issued', 'partially_paid') then
    raise exception 'This invoice cannot accept payments' using errcode = '23514';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Payment amount must be positive' using errcode = '23514';
  end if;
  if p_amount_paise > v_invoice.total_paise - v_invoice.amount_paid_paise then
    raise exception 'Payment exceeds the outstanding balance' using errcode = '23514';
  end if;
  if p_paid_at > now() + interval '5 minutes' then
    raise exception 'Payment date cannot be in the future' using errcode = '23514';
  end if;

  insert into public.payments (invoice_id, patient_id, amount_paise, method, reference, notes, paid_at, received_by, receipt_no, idempotency_key)
  values (v_invoice.id, v_invoice.patient_id, p_amount_paise, p_method, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''),
          coalesce(p_paid_at, now()), auth.uid(),
          'RCPT-' || to_char(now() at time zone private.org_tz(), 'YYYY') || '-' || lpad(private.next_number('receipt')::text, 6, '0'),
          p_idempotency_key)
  returning * into v_payment;

  v_paid := v_invoice.amount_paid_paise + p_amount_paise;
  update public.invoices
     set amount_paid_paise = v_paid,
         status = case when v_paid >= total_paise then 'paid'::public.invoice_status else 'partially_paid'::public.invoice_status end
   where id = v_invoice.id;
  return v_payment;
end;
$$;

create or replace function public.record_refund(p_invoice uuid, p_amount_paise bigint, p_method public.payment_method, p_reason text,
  p_payment uuid default null, p_reference text default null, p_idempotency_key uuid default null)
returns public.refunds language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices;
  v_refund public.refunds;
  v_refunded bigint;
begin
  select * into v_invoice from public.invoices where id = p_invoice for update;
  if not found or not private.can_at('payments.refund', v_invoice.branch_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select * into v_refund from public.refunds where idempotency_key = p_idempotency_key;
    if found then
      if v_refund.invoice_id <> v_invoice.id or v_refund.amount_paise <> p_amount_paise then
        raise exception 'This request key was already used for a different refund' using errcode = '23505';
      end if;
      return v_refund;
    end if;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for a refund' using errcode = '23514';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Refund amount must be positive' using errcode = '23514';
  end if;
  if p_amount_paise > v_invoice.amount_paid_paise - v_invoice.amount_refunded_paise then
    raise exception 'Refund exceeds the amount paid' using errcode = '23514';
  end if;
  if p_payment is not null and not exists (select 1 from public.payments p where p.id = p_payment and p.invoice_id = p_invoice) then
    raise exception 'Payment does not belong to this invoice' using errcode = '23503';
  end if;

  insert into public.refunds (invoice_id, payment_id, refund_no, amount_paise, method, reference, reason, refunded_by, idempotency_key)
  values (v_invoice.id, p_payment,
          'RFND-' || to_char(now() at time zone private.org_tz(), 'YYYY') || '-' || lpad(private.next_number('refund')::text, 6, '0'),
          p_amount_paise, p_method, nullif(trim(p_reference), ''), left(trim(p_reason), 500), auth.uid(), p_idempotency_key)
  returning * into v_refund;

  v_refunded := v_invoice.amount_refunded_paise + p_amount_paise;
  update public.invoices
     set amount_refunded_paise = v_refunded,
         status = case when v_refunded >= amount_paid_paise then 'refunded'::public.invoice_status else status end
   where id = v_invoice.id;
  return v_refund;
end;
$$;

create or replace function public.void_invoice(p_invoice uuid, p_reason text)
returns public.invoices language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where id = p_invoice for update;
  if not found or not private.can_at('billing.void', v_invoice.branch_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_invoice.status = 'void' then
    return v_invoice;
  end if;
  if v_invoice.amount_paid_paise > 0 then
    raise exception 'Invoices with recorded payments cannot be voided' using errcode = '23514';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void an invoice' using errcode = '23514';
  end if;
  update public.invoices set status = 'void', void_reason = left(trim(p_reason), 500) where id = p_invoice returning * into v_invoice;
  return v_invoice;
end;
$$;

create or replace function public.reconcile_payment(p_payment uuid, p_reconciled boolean,
  p_settlement_reference text default null, p_note text default null)
returns public.payments language plpgsql security definer set search_path = '' as $$
declare
  v_row public.payments;
begin
  select pm.* into v_row from public.payments pm where pm.id = p_payment for update;
  if not found or not private.can_at('payments.reconcile', (select i.branch_id from public.invoices i where i.id = v_row.invoice_id)) then
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
-- Row Level Security (writes only through the functions above)
-- -----------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;

create policy invoices_select on public.invoices for select to authenticated
  using (private.can_at('billing.view', branch_id));
create policy invoice_items_select on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy refunds_select on public.refunds for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));

revoke all on public.invoices, public.invoice_items, public.payments, public.refunds from anon, authenticated;
grant select on public.invoices, public.invoice_items, public.payments, public.refunds to authenticated;

revoke execute on all functions in schema private from public;
grant execute on function private.can_see_patient(uuid) to authenticated;
revoke execute on function public.create_invoice(uuid, jsonb, bigint, text, uuid, uuid, uuid),
  public.record_payment(uuid, bigint, public.payment_method, text, timestamptz, text, uuid),
  public.record_refund(uuid, bigint, public.payment_method, text, uuid, text, uuid),
  public.void_invoice(uuid, text), public.reconcile_payment(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, jsonb, bigint, text, uuid, uuid, uuid),
  public.record_payment(uuid, bigint, public.payment_method, text, timestamptz, text, uuid),
  public.record_refund(uuid, bigint, public.payment_method, text, uuid, text, uuid),
  public.void_invoice(uuid, text), public.reconcile_payment(uuid, boolean, text, text) to authenticated;
