-- =============================================================================
-- Vaidyora — 0011 Patient documents, receipts and refunds
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Patient documents
-- -----------------------------------------------------------------------------
-- Upload flow (all steps authorised by RLS):
--   1. INSERT a patient_documents row → trigger assigns storage_path
--      {clinic}/patients/{patient}/{document id}.{ext}
--   2. Upload the file to exactly that path (storage policy checks the row)
--   3. confirm_document_upload() verifies the object exists and stamps uploaded_at
-- Downloads go through the `document-url` Edge Function, which checks access
-- with the caller's JWT, records an audit event, and returns a short-lived
-- signed URL. Clients have no direct SELECT on patient files in storage.
create table public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  patient_id uuid not null,
  investigation_id uuid,
  consultation_id uuid,
  category public.document_category not null default 'other',
  title text not null check (char_length(title) between 1 and 160),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  storage_path text unique,
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  uploaded_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id),
  delete_reason text check (char_length(delete_reason) <= 300),
  created_at timestamptz not null default now(),
  check ((deleted_at is null) = (delete_reason is null)),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (consultation_id, clinic_id) references public.consultations (id, clinic_id)
);
alter table public.investigations add constraint investigations_id_clinic_key unique (id, clinic_id);
alter table public.patient_documents
  add constraint patient_documents_investigation_fk foreign key (investigation_id, clinic_id) references public.investigations (id, clinic_id);
create index patient_documents_patient_idx on public.patient_documents (patient_id, created_at desc) where deleted_at is null;
create index patient_documents_investigation_idx on public.patient_documents (investigation_id) where investigation_id is not null;

create or replace function private.patient_documents_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.storage_path := new.clinic_id || '/patients/' || new.patient_id || '/' || new.id || '.' ||
    case new.mime_type when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' else 'webp' end;
  return new;
end;
$$;
create trigger patient_documents_path before insert on public.patient_documents
  for each row execute function private.patient_documents_path();

-- Only the upload confirmation and soft delete may change a document row.
create or replace function private.patient_documents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['uploaded_at', 'deleted_at', 'deleted_by', 'delete_reason'])
     is distinct from (to_jsonb(old) - array['uploaded_at', 'deleted_at', 'deleted_by', 'delete_reason']) then
    raise exception 'Document metadata cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger patient_documents_guard before update on public.patient_documents
  for each row execute function private.patient_documents_guard();

alter table public.patient_documents enable row level security;
create policy patient_documents_select on public.patient_documents for select to authenticated
  using (deleted_at is null and private.can_read_clinical(clinic_id, patient_id));
create policy patient_documents_insert on public.patient_documents for insert to authenticated
  with check (
    uploaded_by = auth.uid() and uploaded_at is null and deleted_at is null
    and private.can_write_clinical(clinic_id, patient_id)
  );
revoke all on public.patient_documents from anon, authenticated;
grant select, insert on public.patient_documents to authenticated;

create or replace function public.confirm_document_upload(p_document uuid)
returns public.patient_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.patient_documents;
begin
  select * into d from public.patient_documents where id = p_document for update;
  if not found or d.uploaded_by <> auth.uid() or not private.can_write_clinical(d.clinic_id, d.patient_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if d.uploaded_at is not null then
    return d;
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'clinic-files' and o.name = d.storage_path) then
    raise exception 'The file has not been uploaded' using errcode = 'P0002';
  end if;
  update public.patient_documents set uploaded_at = now() where id = p_document returning * into d;
  return d;
end;
$$;

create or replace function public.delete_document(p_document uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.patient_documents;
begin
  select * into d from public.patient_documents where id = p_document and deleted_at is null for update;
  if not found or not private.can_write_clinical(d.clinic_id, d.patient_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to remove a document' using errcode = '23514';
  end if;
  -- Soft delete: the file is retained for the medico-legal retention period.
  update public.patient_documents
     set deleted_at = now(), deleted_by = auth.uid(), delete_reason = left(trim(p_reason), 300)
   where id = p_document;
end;
$$;

-- Storage: replace the earlier patient-file policies with document-bound ones.
drop policy clinic_files_read on storage.objects;
drop policy clinic_files_insert on storage.objects;
drop policy clinic_files_update on storage.objects;

create or replace function private.storage_can_upload(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_clinic uuid;
begin
  begin
    v_clinic := v_parts[1]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if v_parts[2] = 'branding' then
    return private.has_permission(v_clinic, 'settings.manage');
  elsif v_parts[2] = 'patients' then
    return exists (
      select 1 from public.patient_documents d
      where d.storage_path = p_name and d.uploaded_by = auth.uid() and d.uploaded_at is null and d.deleted_at is null
        and private.can_write_clinical(d.clinic_id, d.patient_id)
    );
  end if;
  return false;
end;
$$;

create policy clinic_files_branding_read on storage.objects for select to authenticated
  using (bucket_id = 'clinic-files' and split_part(name, '/', 2) = 'branding' and private.storage_can_read(name));
create policy clinic_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinic-files' and private.storage_can_upload(name));
create policy clinic_files_branding_update on storage.objects for update to authenticated
  using (bucket_id = 'clinic-files' and split_part(name, '/', 2) = 'branding' and private.storage_can_write(name))
  with check (bucket_id = 'clinic-files' and split_part(name, '/', 2) = 'branding' and private.storage_can_write(name));

-- -----------------------------------------------------------------------------
-- Receipts and refunds
-- -----------------------------------------------------------------------------
-- invoices.amount_paid_paise / amount_refunded_paise are intentional
-- denormalisations: cached sums of payments/refunds, maintained only by the
-- RPCs below under a row lock, so balances and statuses are cheap to filter.
alter table public.payments
  add column receipt_no text,
  add constraint payments_receipt_unique unique (clinic_id, receipt_no);
alter table public.invoices
  add column amount_refunded_paise bigint not null default 0 check (amount_refunded_paise >= 0),
  add column updated_by uuid references auth.users (id) on delete set null,
  add constraint invoices_refund_le_paid check (amount_refunded_paise <= amount_paid_paise);
create trigger invoices_updated_by before update on public.invoices
  for each row execute function private.set_updated_by();
alter table public.payments add constraint payments_id_clinic_key unique (id, clinic_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  invoice_id uuid not null,
  payment_id uuid,
  refund_no text not null,
  amount_paise bigint not null check (amount_paise > 0),
  method public.payment_method not null,
  reference text check (char_length(reference) <= 80),
  reason text not null check (char_length(reason) between 1 and 500),
  refunded_at timestamptz not null default now(),
  refunded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (clinic_id, refund_no),
  foreign key (invoice_id, clinic_id) references public.invoices (id, clinic_id),
  foreign key (payment_id, clinic_id) references public.payments (id, clinic_id)
);
create index refunds_clinic_date_idx on public.refunds (clinic_id, refunded_at desc);
create index refunds_invoice_idx on public.refunds (invoice_id);
create trigger refunds_immutable before update or delete on public.refunds
  for each row execute function private.immutable_row();
create trigger payments_immutable before delete on public.payments
  for each row execute function private.immutable_row();

alter table public.refunds enable row level security;
create policy refunds_select on public.refunds for select to authenticated
  using (private.has_permission(clinic_id, 'billing.read'));
revoke all on public.refunds from anon, authenticated;
grant select on public.refunds to authenticated;

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
  if not found or not private.has_permission(v_invoice.clinic_id, 'payments.record')
     or not private.in_branch_scope(v_invoice.clinic_id, v_invoice.branch_id) then
    raise exception 'Not permitted' using errcode = '42501';
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

  insert into public.payments (clinic_id, invoice_id, patient_id, amount_paise, method, reference, notes, paid_at, received_by, receipt_no)
  values (v_invoice.clinic_id, v_invoice.id, v_invoice.patient_id, p_amount_paise, p_method,
          nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), coalesce(p_paid_at, now()), auth.uid(),
          'RCPT-' || to_char(now() at time zone private.clinic_tz(v_invoice.clinic_id), 'YYYY') || '-'
            || lpad(private.next_number(v_invoice.clinic_id, 'receipt')::text, 6, '0'))
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

create or replace function public.record_refund(
  p_invoice uuid,
  p_amount_paise bigint,
  p_method public.payment_method,
  p_reason text,
  p_payment uuid default null,
  p_reference text default null
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

  insert into public.refunds (clinic_id, invoice_id, payment_id, refund_no, amount_paise, method, reference, reason, refunded_by)
  values (v_invoice.clinic_id, v_invoice.id, p_payment,
          'RFND-' || to_char(now() at time zone private.clinic_tz(v_invoice.clinic_id), 'YYYY') || '-'
            || lpad(private.next_number(v_invoice.clinic_id, 'refund')::text, 6, '0'),
          p_amount_paise, p_method, nullif(trim(p_reference), ''), left(trim(p_reason), 500), auth.uid())
  returning * into v_refund;

  v_refunded := v_invoice.amount_refunded_paise + p_amount_paise;
  update public.invoices
     set amount_refunded_paise = v_refunded,
         status = case when v_refunded >= amount_paid_paise then 'refunded'::public.invoice_status else status end
   where id = v_invoice.id;
  return v_refund;
end;
$$;

-- create_invoice: clinic time zone for numbering and branch scope.
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
  v_branch uuid := p_branch;
begin
  if not private.has_permission(p_clinic, 'billing.create') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_branch is null then
    select m.default_branch_id into v_branch from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = auth.uid();
  end if;
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
    subtotal_paise, tax_paise, discount_paise, total_paise, notes, created_by
  ) values (
    p_clinic, v_branch, p_patient, p_appointment,
    v_prefix || '-' || to_char(now() at time zone private.clinic_tz(p_clinic), 'YYYY') || '-'
      || lpad(private.next_number(p_clinic, 'invoice')::text, 6, '0'),
    private.clinic_today(p_clinic),
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

-- Invoices are branch-scoped for members restricted to particular branches.
drop policy invoices_select on public.invoices;
drop policy invoice_items_select on public.invoice_items;
drop policy payments_select on public.payments;
create policy invoices_select on public.invoices for select to authenticated
  using (private.has_permission(clinic_id, 'billing.read') and private.in_branch_scope(clinic_id, branch_id));
create policy invoice_items_select on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));

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

revoke execute on function public.confirm_document_upload(uuid) from public, anon;
revoke execute on function public.delete_document(uuid, text) from public, anon;
revoke execute on function public.record_refund(uuid, bigint, public.payment_method, text, uuid, text) from public, anon;
grant execute on function public.confirm_document_upload(uuid) to authenticated;
grant execute on function public.delete_document(uuid, text) to authenticated;
grant execute on function public.record_refund(uuid, bigint, public.payment_method, text, uuid, text) to authenticated;
