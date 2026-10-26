-- =============================================================================
-- Vaidyora — 0007 New enumerations and permission keys (Phases 4–6)
-- =============================================================================
-- Kept in its own migration: a new enum value cannot be referenced in the same
-- transaction that adds it.
-- =============================================================================

alter type public.invoice_status add value if not exists 'refunded';

create type public.clinic_status as enum ('active', 'suspended', 'closed');
create type public.patient_status as enum ('active', 'inactive', 'deceased');
create type public.appointment_source as enum ('walk_in', 'phone', 'online', 'referral', 'follow_up', 'other');
create type public.ama_level as enum ('absent', 'mild', 'moderate', 'severe');
create type public.medicine_route as enum ('oral', 'topical', 'nasal', 'rectal', 'ophthalmic', 'otic', 'other');
create type public.document_category as enum ('lab_report', 'imaging', 'external_prescription', 'consent_form', 'clinical_photo', 'other');
create type public.consent_type as enum ('treatment', 'data_processing', 'sms_reminders', 'whatsapp_reminders', 'clinical_photography');
create type public.consent_method as enum ('verbal', 'written', 'digital');
create type public.consent_status as enum ('granted', 'withdrawn');
create type public.followup_status as enum ('pending', 'booked', 'completed', 'cancelled');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled', 'expired');
create type public.billing_interval as enum ('monthly', 'yearly');
create type public.platform_role as enum ('owner', 'support');
create type public.exam_field_type as enum ('text', 'number', 'select', 'boolean');

insert into public.permissions (key, description) values
  ('payments.refund', 'Record refunds against payments'),
  ('subscription.read', 'View the clinic subscription and plan limits'),
  ('consents.manage', 'Record and withdraw patient consents')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role, permission) values
  ('admin', 'payments.refund'),
  ('admin', 'subscription.read'),
  ('admin', 'consents.manage'),
  ('doctor', 'consents.manage'),
  ('accountant', 'payments.refund'),
  ('receptionist', 'consents.manage'),
  ('branch_manager', 'consents.manage')
on conflict do nothing;
