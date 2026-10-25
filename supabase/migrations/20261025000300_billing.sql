-- =============================================================================
-- Vaidyora — 0003 Billing and payments
-- =============================================================================
-- Money is stored as integer paise (bigint) to avoid floating point errors.
-- Invoices and payments are written only through SECURITY DEFINER RPCs that
-- compute totals server-side inside a single transaction; clients have no
-- direct INSERT/UPDATE privileges on these tables.
-- Totals: total = subtotal + tax − discount (discount ≤ subtotal + tax).
-- =============================================================================

create type public.invoice_status as enum ('issued', 'partially_paid', 'paid', 'void');
create type public.invoice_item_type as enum ('consultation', 'procedure', 'panchakarma', 'medicine', 'investigation', 'other');
create type public.payment_method as enum ('cash', 'upi', 'card', 'bank_transfer', 'other');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  branch_id uuid,
  patient_id uuid not null,
  appointment_id uuid,
  invoice_no text not null,
  status public.invoice_status not null default 'issued',
  issue_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  amount_paid_paise bigint not null default 0 check (amount_paid_paise >= 0),
  notes text check (char_length(notes) <= 1000),
  void_reason text check (char_length(void_reason) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, invoice_no),
  check (total_paise = subtotal_paise + tax_paise - discount_paise),
  check (amount_paid_paise <= total_paise),
  check (status <> 'void' or void_reason is not null),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (branch_id, clinic_id) references public.branches (id, clinic_id),
  foreign key (appointment_id, clinic_id) references public.appointments (id, clinic_id)
);
create index invoices_clinic_date_idx on public.invoices (clinic_id, issue_date desc);
create index invoices_patient_idx on public.invoices (patient_id);
create index invoices_outstanding_idx on public.invoices (clinic_id) where status in ('issued', 'partially_paid');
create trigger invoices_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();
create trigger invoices_clinic_immutable before update on public.invoices
  for each row execute function private.prevent_clinic_change();

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  invoice_id uuid not null,
  position smallint not null default 0,
  item_type public.invoice_item_type not null default 'other',
  description text not null check (char_length(description) between 1 and 200),
  quantity numeric(10, 2) not null check (quantity > 0 and quantity <= 10000),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 28),
  line_total_paise bigint not null check (line_total_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  foreign key (invoice_id, clinic_id) references public.invoices (id, clinic_id) on delete cascade
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  invoice_id uuid not null,
  patient_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  method public.payment_method not null,
  reference text check (char_length(reference) <= 80),
  notes text check (char_length(notes) <= 500),
  paid_at timestamptz not null default now(),
  received_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (invoice_id, clinic_id) references public.invoices (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id)
);
create index payments_clinic_paid_idx on public.payments (clinic_id, paid_at desc);
create index payments_invoice_idx on public.payments (invoice_id);

-- -----------------------------------------------------------------------------
-- RPC: create an invoice with line items, totals computed server-side.
-- p_items: [{ "description": text, "item_type": text, "quantity": number,
--             "unit_price_paise": integer, "tax_rate": number }]
-- -----------------------------------------------------------------------------
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
begin
  if not private.has_permission(p_clinic, 'billing.create') then
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
    clinic_id, branch_id, patient_id, appointment_id, invoice_no,
    subtotal_paise, tax_paise, discount_paise, total_paise, notes, created_by
  ) values (
    p_clinic, p_branch, p_patient, p_appointment,
    v_prefix || '-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-'
      || lpad(private.next_number(p_clinic, 'invoice')::text, 6, '0'),
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

-- -----------------------------------------------------------------------------
-- RPC: record a payment against an invoice (row-locked; prevents overpayment).
-- -----------------------------------------------------------------------------
create or replace function public.record_payment(
  p_invoice uuid,
  p_amount_paise bigint,
  p_method public.payment_method,
  p_reference text default null,
  p_paid_at timestamptz default now(),
  p_notes text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_payment public.payments;
  v_paid bigint;
begin
  select * into v_invoice from public.invoices where id = p_invoice for update;
  if not found or not private.has_permission(v_invoice.clinic_id, 'payments.record') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_invoice.status in ('void', 'paid') then
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

  insert into public.payments (clinic_id, invoice_id, patient_id, amount_paise, method, reference, notes, paid_at, received_by)
  values (v_invoice.clinic_id, v_invoice.id, v_invoice.patient_id, p_amount_paise, p_method,
          nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), coalesce(p_paid_at, now()), auth.uid())
  returning * into v_payment;

  v_paid := v_invoice.amount_paid_paise + p_amount_paise;
  update public.invoices
     set amount_paid_paise = v_paid,
         status = case when v_paid >= total_paise then 'paid'::public.invoice_status
                       else 'partially_paid'::public.invoice_status end
   where id = v_invoice.id;

  return v_payment;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: void an unpaid invoice (refunds are a future feature).
-- -----------------------------------------------------------------------------
create or replace function public.void_invoice(p_invoice uuid, p_reason text)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where id = p_invoice for update;
  if not found or not private.has_permission(v_invoice.clinic_id, 'billing.void') then
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

  update public.invoices set status = 'void', void_reason = left(trim(p_reason), 500)
   where id = p_invoice returning * into v_invoice;
  return v_invoice;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS — read-only for clients; writes go through the RPCs above.
-- -----------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;

create policy invoices_select on public.invoices for select to authenticated
  using (private.has_permission(clinic_id, 'billing.read'));
create policy invoice_items_select on public.invoice_items for select to authenticated
  using (private.has_permission(clinic_id, 'billing.read'));
create policy payments_select on public.payments for select to authenticated
  using (private.has_permission(clinic_id, 'billing.read'));

revoke all on public.invoices, public.invoice_items, public.payments from anon, authenticated;
grant select on public.invoices, public.invoice_items, public.payments to authenticated;

revoke execute on function public.create_invoice(uuid, uuid, jsonb, bigint, text, uuid, uuid) from public, anon;
revoke execute on function public.record_payment(uuid, bigint, public.payment_method, text, timestamptz, text) from public, anon;
revoke execute on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.create_invoice(uuid, uuid, jsonb, bigint, text, uuid, uuid) to authenticated;
grant execute on function public.record_payment(uuid, bigint, public.payment_method, text, timestamptz, text) to authenticated;
grant execute on function public.void_invoice(uuid, text) to authenticated;
