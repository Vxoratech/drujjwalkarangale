/**
 * Hand-written facts about each table that cannot be read from the catalog.
 * tests/db/docs.test.ts fails if a table is added without an entry here.
 */
export interface TableAnnotation {
  group: string;
  purpose: string;
  tenantScope: string;
  retention: string;
  notes?: string;
}

const CLINIC = 'Tenant-owned: `clinic_id` (immutable, composite FKs to parents).';
const CLINICAL_RETENTION = 'Never hard-deleted. Kept for the medico-legal retention period (minimum 3 years from the last visit under Indian medical-records guidance; clinics often keep longer).';
const FINANCE_RETENTION = 'Never deleted; kept at least 8 years for tax records. Corrections are made by void/refund, not edits.';

export const TABLES: Record<string, TableAnnotation> = {
  // Platform & tenancy
  platform_admins: { group: 'Platform', purpose: 'Trusted platform (Super Admin) operators. Separate from clinic membership.', tenantScope: 'Platform-level (no clinic). Provisioned only with SQL or the service role.', retention: 'Removed when an operator leaves; changes are audited as platform events.' },
  subscription_plans: { group: 'Platform', purpose: 'SaaS plan catalogue: price, interval and limits (`max_doctors`, `max_branches`, `max_staff`).', tenantScope: 'Platform reference data; active public plans are readable by signed-in users.', retention: 'Plans are deactivated, never deleted, so historical subscriptions stay valid.' },
  tenant_subscriptions: { group: 'Platform', purpose: 'Current subscription state of each clinic, with provider references for future billing integration.', tenantScope: CLINIC + ' One row per clinic. Written only by platform RPCs.', retention: 'Kept for the life of the clinic; history is in `audit_events`.', notes: 'Subscription status does not gate access to clinical records (patient safety); the platform suspends a clinic explicitly instead.' },
  clinics: { group: 'Tenancy', purpose: 'Tenant: identity, legal details, contact, time zone, language, branding, configuration and lifecycle status.', tenantScope: 'The tenant itself. Visible to its members; `status` is changed only by the platform.', retention: 'Closed clinics are retained (status `closed`); data export and deletion follow the contract with the clinic.' },
  branches: { group: 'Tenancy', purpose: 'Physical locations of a clinic.', tenantScope: CLINIC, retention: 'Deactivated (`is_active = false`), never deleted, because appointments and invoices reference them.' },
  profiles: { group: 'Identity', purpose: 'Display profile for an auth user (name, phone, qualification, registration number, language).', tenantScope: 'Per user. Readable by the user and by colleagues who share a clinic.', retention: 'Deleted with the auth user (cascade); references elsewhere are set to null.' },
  clinic_members: { group: 'Identity', purpose: 'Membership of a user in a clinic: roles, status (invited/active/suspended), default branch.', tenantScope: CLINIC, retention: 'Suspended instead of deleted, so audit trails keep resolving. The last active admin cannot be removed.' },
  member_branches: { group: 'Identity', purpose: 'Optional branch scope for a membership. No rows means all branches.', tenantScope: CLINIC, retention: 'Hard-deleted when scope changes (audited).' },
  permissions: { group: 'Authorization', purpose: 'Catalogue of permission keys.', tenantScope: 'Global reference data (readable by any signed-in user; contains no tenant data).', retention: 'Managed by migrations.' },
  role_permissions: { group: 'Authorization', purpose: 'Role → permission mapping. Future roles are configured here without schema changes.', tenantScope: 'Global reference data (readable by any signed-in user).', retention: 'Managed by migrations.' },
  // Patients
  patients: { group: 'Patients', purpose: 'Patient registry: identity, contact, minimal background, assigned doctor, status.', tenantScope: CLINIC + ' Clinic-wide across branches; doctors see only assigned/booked patients.', retention: CLINICAL_RETENTION + ' `status` = inactive/deceased hides them from active lists but keeps history.', notes: 'Only `first_name` is required (data minimisation). Approximate age is stored when the date of birth is unknown.' },
  patient_consents: { group: 'Patients', purpose: 'Consent records (treatment, data processing, reminders, photography) with method and policy version.', tenantScope: CLINIC, retention: 'Append-only; withdrawal is recorded, never erased.' },
  patient_documents: { group: 'Patients', purpose: 'Metadata for uploaded files (reports, images, external prescriptions). Files live in Storage at `{clinic}/patients/{patient}/{document}.{ext}`.', tenantScope: CLINIC + ' Clinical access rules.', retention: 'Soft-deleted with a reason; the file is retained for the clinical retention period.' },
  // Scheduling
  appointments: { group: 'Scheduling', purpose: 'Bookings: patient, doctor, branch, time range, type, source, status and cancellation details.', tenantScope: CLINIC + ' Branch-scoped.', retention: 'Cancelled/no-show appointments are kept (status), never deleted.', notes: 'Concurrency-safe booking: the GiST exclusion constraint rejects overlapping slots for a doctor atomically, so two simultaneous bookings cannot both succeed (the second gets SQLSTATE 23P01).' },
  follow_ups: { group: 'Scheduling', purpose: 'Follow-up due dates created when a consultation is finalized; linked to the appointment once booked.', tenantScope: CLINIC + ' Visible to clinicians and to staff who manage appointments (no clinical notes).', retention: 'Kept with the clinical record.' },
  // Clinical
  consultations: { group: 'Clinical', purpose: 'A visit record: complaints, history, vitals, findings, assessment, diagnoses, plan, pathya/apathya, follow-up.', tenantScope: CLINIC + ' Branch-scoped; clinical access rules.', retention: CLINICAL_RETENTION + ' Finalized records are immutable.' },
  ayurvedic_examinations: { group: 'Clinical', purpose: 'Structured and narrative Ayurvedic examination for one consultation, plus clinic-configured fields (`custom_fields`).', tenantScope: CLINIC, retention: 'Locked with its consultation.', notes: 'All values are entered by the clinician. The software does not compute or validate diagnoses.' },
  exam_field_definitions: { group: 'Clinical', purpose: 'Clinic-configured examination fields (key, labels in English/Marathi, type, options).', tenantScope: CLINIC, retention: 'Deactivated, not deleted, so historical values stay interpretable.' },
  prescriptions: { group: 'Clinical', purpose: 'Prescription header: doctor, consultation, language, instructions, follow-up, status, revision number.', tenantScope: CLINIC + ' Clinical access rules.', retention: CLINICAL_RETENTION + ' Issued versions are preserved in `prescription_revisions`.' },
  prescription_items: { group: 'Clinical', purpose: 'Medicines on a prescription: form, route, dose, quantity, frequency, timing, anupana, duration, instructions (EN/MR).', tenantScope: CLINIC, retention: 'Editable (and deletable) only while the prescription is a draft; each issued state is snapshotted.' },
  prescription_revisions: { group: 'Clinical', purpose: 'Immutable snapshot of each issued revision (header + items).', tenantScope: CLINIC, retention: 'Append-only for the clinical retention period.' },
  prescription_templates: { group: 'Clinical', purpose: 'Clinician-authored reusable prescription templates (private or shared within the clinic).', tenantScope: CLINIC, retention: 'Deactivated, not deleted.', notes: 'Templates are written by clinicians. Vaidyora never generates or recommends doses.' },
  investigations: { group: 'Clinical', purpose: 'Requested tests and their results.', tenantScope: CLINIC + ' Clinical access rules.', retention: CLINICAL_RETENTION },
  // Billing
  invoices: { group: 'Billing', purpose: 'Invoice header with server-computed totals in paise and cached paid/refunded sums.', tenantScope: CLINIC + ' Branch-scoped.', retention: FINANCE_RETENTION, notes: 'Intentional denormalisation: `amount_paid_paise` and `amount_refunded_paise` cache sums of payments/refunds. They are updated only by RPCs under a row lock; a test checks they match.' },
  invoice_items: { group: 'Billing', purpose: 'Invoice lines (type, description, quantity, rate, GST rate, line and tax amounts).', tenantScope: CLINIC, retention: FINANCE_RETENTION },
  payments: { group: 'Billing', purpose: 'Payments against invoices, with method, reference and receipt number.', tenantScope: CLINIC, retention: FINANCE_RETENTION },
  refunds: { group: 'Billing', purpose: 'Refunds against invoices/payments, with reason and refund number.', tenantScope: CLINIC, retention: FINANCE_RETENTION + ' Immutable.' },
  // Cross-cutting
  audit_events: { group: 'Audit', purpose: 'Append-only security and change log: actor, action, event type, entity, changed field names, non-PHI metadata.', tenantScope: 'Clinic events carry `clinic_id`; platform events have none and are visible only to platform admins.', retention: 'Kept for `clinics.audit_retention_days` (default 8 years, minimum 3), then removed by `purge_expired_audit_events()` (service role only).' },
  notifications: { group: 'Cross-cutting', purpose: 'In-app notifications for a user (generic titles, no patient names).', tenantScope: CLINIC + ' Visible only to the recipient.', retention: 'May be purged after 90 days (no clinical content).' },
};

export const SCHEMA_GROUP_ORDER = ['Platform', 'Tenancy', 'Identity', 'Authorization', 'Patients', 'Scheduling', 'Clinical', 'Billing', 'Audit', 'Cross-cutting'];
