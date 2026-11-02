-- =============================================================================
-- Vaidyora — 0015 Idempotent money operations, rate limits, file safety
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Idempotency keys
-- -----------------------------------------------------------------------------
-- The client generates one UUID per user action (opening the payment dialog,
-- say) and resends it on retry. A retry with the same key returns the row the
-- first call created; the same key with different details is rejected. The
-- unique index makes simultaneous duplicates fail instead of double-charging.
alter table public.payments add column idempotency_key uuid;
alter table public.refunds add column idempotency_key uuid;
alter table public.invoices add column idempotency_key uuid;
create unique index payments_idempotency_key on public.payments (clinic_id, idempotency_key) where idempotency_key is not null;
create unique index refunds_idempotency_key on public.refunds (clinic_id, idempotency_key) where idempotency_key is not null;
create unique index invoices_idempotency_key on public.invoices (clinic_id, idempotency_key) where idempotency_key is not null;

drop function public.record_payment(uuid, bigint, public.payment_method, text, timestamptz, text);
drop function public.record_refund(uuid, bigint, public.payment_method, text, uuid, text);
drop function public.create_invoice(uuid, uuid, jsonb, bigint, text, uuid, uuid);

create function public.record_payment(
  p_invoice uuid,
  p_amount_paise bigint,
  p_method public.payment_method,
  p_reference text default null,
  p_paid_at timestamptz default now(),
  p_notes text default null,
  p_idempotency_key uuid default null
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
  if not found or not private.has_permission(v_invoice.clinic_id, 'payments.record')
     or not private.in_branch_scope(v_invoice.clinic_id, v_invoice.branch_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  -- Idempotent retry: the same key returns the payment it created.
  if p_idempotency_key is not null then
    select * into v_payment from public.payments
     where clinic_id = v_invoice.clinic_id and idempotency_key = p_idempotency_key;
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

  insert into public.payments (clinic_id, invoice_id, patient_id, amount_paise, method, reference, notes, paid_at, received_by, receipt_no, idempotency_key)
  values (v_invoice.clinic_id, v_invoice.id, v_invoice.patient_id, p_amount_paise, p_method,
          nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), coalesce(p_paid_at, now()), auth.uid(),
          'RCPT-' || to_char(now() at time zone private.clinic_tz(v_invoice.clinic_id), 'YYYY') || '-'
            || lpad(private.next_number(v_invoice.clinic_id, 'receipt')::text, 6, '0'),
          p_idempotency_key)
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

create function public.record_refund(
  p_invoice uuid,
  p_amount_paise bigint,
  p_method public.payment_method,
  p_reason text,
  p_payment uuid default null,
  p_reference text default null,
  p_idempotency_key uuid default null
)
returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_refund public.refunds;
  v_refunded bigint;
begin
  select * into v_invoice from public.invoices where id = p_invoice for update;
  if not found or not private.has_permission(v_invoice.clinic_id, 'payments.refund')
     or not private.in_branch_scope(v_invoice.clinic_id, v_invoice.branch_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select * into v_refund from public.refunds
     where clinic_id = v_invoice.clinic_id and idempotency_key = p_idempotency_key;
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

  insert into public.refunds (clinic_id, invoice_id, payment_id, refund_no, amount_paise, method, reference, reason, refunded_by, idempotency_key)
  values (v_invoice.clinic_id, v_invoice.id, p_payment,
          'RFND-' || to_char(now() at time zone private.clinic_tz(v_invoice.clinic_id), 'YYYY') || '-'
            || lpad(private.next_number(v_invoice.clinic_id, 'refund')::text, 6, '0'),
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

create function public.create_invoice(
  p_clinic uuid,
  p_patient uuid,
  p_items jsonb,
  p_discount_paise bigint default 0,
  p_notes text default null,
  p_appointment uuid default null,
  p_branch uuid default null,
  p_idempotency_key uuid default null
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
  -- Idempotent retry: the same key returns the invoice it created.
  if p_idempotency_key is not null then
    select * into v_invoice from public.invoices where clinic_id = p_clinic and idempotency_key = p_idempotency_key;
    if found then
      if v_invoice.patient_id <> p_patient then
        raise exception 'This request key was already used for a different invoice' using errcode = '23505';
      end if;
      return v_invoice;
    end if;
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
    subtotal_paise, tax_paise, discount_paise, total_paise, notes, created_by, idempotency_key
  ) values (
    p_clinic, v_branch, p_patient, p_appointment,
    v_prefix || '-' || to_char(now() at time zone private.clinic_tz(p_clinic), 'YYYY') || '-'
      || lpad(private.next_number(p_clinic, 'invoice')::text, 6, '0'),
    private.clinic_today(p_clinic),
    0, 0, 0, 0, nullif(trim(p_notes), ''), auth.uid(), p_idempotency_key
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
-- Rate limiting (fixed windows)
-- -----------------------------------------------------------------------------
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- Returns true when the call is allowed. Old windows for the same key are
-- pruned on each call, so the table stays small.
create or replace function private.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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

-- For Edge Functions (service role): e.g. invites per user per hour.
create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.hit_rate_limit(p_key, p_limit, p_window_seconds);
$$;
revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Bulk-access brake: opening more than 300 patient records in 10 minutes is
-- refused. The refusal must be audited, and an exception would roll the audit
-- row back, so the brake returns false and view_patient() returns no row
-- (the app shows a "too many records" message).
drop function private.log_patient_view(uuid, uuid);
create function private.log_patient_view(p_clinic uuid, p_patient uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_read_patient(p_clinic, p_patient) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not private.hit_rate_limit('patient_view:' || auth.uid(), 300, 600) then
    perform private.log_event(p_clinic, 'security.rate_limited', 'security', 'patients', p_patient, '{}', jsonb_build_object('limit', 'patient_view'));
    return false;
  end if;
  if not exists (
    select 1 from public.audit_events e
    where e.actor_id = auth.uid() and e.event_type = 'patients.viewed' and e.entity_id = p_patient
      and e.created_at > now() - interval '10 minutes'
  ) then
    perform private.log_event(p_clinic, 'patients.viewed', 'view', 'patients', p_patient);
  end if;
  return true;
end;
$$;
grant execute on function private.log_patient_view(uuid, uuid) to authenticated;

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
  if not private.log_patient_view(v_row.clinic_id, v_row.id) then
    return null; -- rate-limited; the refusal has been audited
  end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Files
-- -----------------------------------------------------------------------------
-- Display names may not contain path separators or control characters (the
-- storage path never uses them anyway: it is built from the document id).
alter table public.patient_documents
  add constraint patient_documents_safe_file_name check (file_name !~ '[/\\[:cntrl:]]' and file_name !~ '^\.');

-- Uploads that were started but never confirmed (browser closed mid-upload).
-- A scheduled job (service role) calls this and then deletes the returned
-- storage paths through the Storage API.
create or replace function public.purge_abandoned_uploads(p_older_than interval default interval '24 hours')
returns table (storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  delete from public.patient_documents d
  where d.uploaded_at is null and d.created_at < now() - p_older_than
  returning d.storage_path;
end;
$$;
revoke execute on function public.purge_abandoned_uploads(interval) from public, anon, authenticated;
grant execute on function public.purge_abandoned_uploads(interval) to service_role;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.record_payment(uuid, bigint, public.payment_method, text, timestamptz, text, uuid) from public, anon;
revoke execute on function public.record_refund(uuid, bigint, public.payment_method, text, uuid, text, uuid) from public, anon;
revoke execute on function public.create_invoice(uuid, uuid, jsonb, bigint, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.record_payment(uuid, bigint, public.payment_method, text, timestamptz, text, uuid) to authenticated;
grant execute on function public.record_refund(uuid, bigint, public.payment_method, text, uuid, text, uuid) to authenticated;
grant execute on function public.create_invoice(uuid, uuid, jsonb, bigint, text, uuid, uuid, uuid) to authenticated;
revoke execute on function private.hit_rate_limit(text, integer, integer) from public;
