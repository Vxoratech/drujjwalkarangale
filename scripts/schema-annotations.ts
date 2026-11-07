/**
 * Hand-written facts about each table that cannot be read from the catalog.
 * tests/db/docs.test.ts fails if a table is added without an entry here.
 */
export interface TableAnnotation {
  group: string;
  purpose: string;
  /** Who can see rows: permission and branch scope. */
  access: string;
  retention: string;
  notes?: string;
}

const BRANCH = 'Branch-scoped: doctor and admin see every branch; staff see rows of their assigned branches.';
const CLINICAL = 'Clinical: read needs the clinical view permission at the visit branch; written only by the primary doctor (doctor-only permissions).';
const CLINICAL_RETENTION = 'Never hard-deleted. Kept for the medico-legal retention period (minimum 3 years from the last visit under Indian medical-records guidance; clinics often keep longer).';
const FINANCE_RETENTION = 'Never deleted; kept at least 8 years for tax records. Corrections are made by void/refund, not edits.';

export const TABLES: Record<string, TableAnnotation> = {
  // Organization
  organization: { group: 'Organization', purpose: 'The single clinic organization: identity, legal details, contact, and the permanent primary-doctor reference.', access: 'Readable by every active account; edited with `settings.organization`.', retention: 'Exactly one row, created by migration; cannot be deleted.', notes: '`singleton` is unique and always true, so a second organization cannot be inserted. `primary_doctor_id` is set once by trusted setup and is then immutable.' },
  clinic_settings: { group: 'Organization', purpose: 'Organization-wide settings: time zone, language, numbering prefix, fee, branding, audit retention, preferences.', access: 'Readable by every active account; edited with `settings.organization`.', retention: 'One row; cannot be deleted.' },
  clinic_branches: { group: 'Organization', purpose: 'Clinic branches: code, address, contact, active state, branch manager.', access: 'Readable by every active account. Created and (de)activated with `branches.manage`; contact details also with `settings.branch` at that branch.', retention: 'Deactivated, never deleted, because visits and invoices reference them. The primary branch cannot be deactivated.' },
  branch_working_hours: { group: 'Organization', purpose: 'Opening windows per branch and weekday, with slot length. Bookings must fall inside them when a branch has hours.', access: 'Readable by every active account; replaced as a week with `set_branch_hours`.', retention: 'Replaced on every change (audited).' },
  // Identity and access
  user_profiles: { group: 'Identity and access', purpose: 'One profile per auth user: account type (`primary_doctor`, `admin`, `staff`), display details, active flag.', access: 'Own profile always; names of colleagues for active accounts. Users edit only their own display fields.', retention: 'Deleted with the auth user; the primary doctor profile cannot be deleted.', notes: 'Account type and active flag change only inside trusted identity functions; a unique partial index allows at most one primary doctor.' },
  staff_members: { group: 'Identity and access', purpose: 'Staff records: name, contact, designation, role template, employment details, invitation and activation status.', access: 'Doctor and admin: all. Staff with `staff.view`: staff sharing a branch. Everyone: their own record. Written only through staff-management functions.', retention: 'Deactivated with a reason, never deleted, so audit trails keep resolving.' },
  staff_branch_assignments: { group: 'Identity and access', purpose: 'Which branches a staff member works at. Separate from permissions.', access: 'As for the staff member. Written with `set_staff_branches` (`staff.manage`).', retention: 'Replaced on change (audited with before/after).' },
  staff_permission_overrides: { group: 'Identity and access', purpose: 'Per-staff grants and denies on top of the role template.', access: 'As for the staff member. Written with `set_staff_access` (`staff.permissions`).', retention: 'Replaced on change (audited with granted/revoked keys).', notes: 'Doctor-only permissions are rejected by trigger.' },
  roles: { group: 'Identity and access', purpose: 'Role templates. `account` roles back the primary doctor and admin; `staff` roles are editable templates (Receptionist, Accountant, …).', access: 'Readable by every active account. Staff templates are edited with `staff.permissions`; account roles only by migration.', retention: 'Custom templates can be deleted when unused; built-in templates cannot.' },
  role_permissions: { group: 'Identity and access', purpose: 'Template → permission mapping.', access: 'Readable by every active account.', retention: 'Replaced through `save_role_template` (audited).', notes: 'Doctor-only permissions may appear only in the `primary_doctor` account role.' },
  permissions: { group: 'Identity and access', purpose: 'Permission catalogue: module, action, label, sensitivity, doctor-only flag.', access: 'Readable by every active account.', retention: 'Managed by migrations.' },
  // Patients
  patients: { group: 'Patients', purpose: 'Central patient profile (one per person across branches): identity, contact, registering branch, status.', access: 'Organization-wide with `patients.view_basic` (so returning patients are found at any branch); billing staff also see patients they bill.', retention: CLINICAL_RETENTION + ' `status` = inactive/deceased hides them from active lists but keeps history.', notes: 'Registered only through `register_patient`, which refuses likely duplicates until the user confirms they reviewed them. Nothing is merged automatically.' },
  patient_medical_profiles: { group: 'Patients', purpose: 'Medical background: blood group, allergies, chronic conditions, prakriti.', access: 'Clinical: `patients.view_history` plus a visit at one of the viewer\'s branches; written by the doctor.', retention: CLINICAL_RETENTION, notes: 'Kept apart from `patients` so front-desk access never includes history.' },
  patient_consents: { group: 'Patients', purpose: 'Consent records (treatment, data processing, reminders, photography) with method and policy version.', access: 'Whoever can see the patient; recorded with `consents.manage`.', retention: 'Append-only; withdrawal is recorded, never erased.' },
  patient_documents: { group: 'Patients', purpose: 'Metadata for uploaded files. Files live in Storage at `patients/{patient}/{document}.{ext}`.', access: 'Opened with `documents.view` at the branch; uploaded with `investigations.upload`.', retention: 'Soft-deleted with a reason; the file is retained for the clinical retention period.' },
  // Scheduling
  appointments: { group: 'Scheduling', purpose: 'Bookings with Dr. Ujjwal: patient, branch, time range, type, source, status and cancellation details.', access: BRANCH + ' Booking, rescheduling, cancelling and check-in are separate permissions.', retention: 'Cancelled/no-show appointments are kept (status), never deleted.', notes: 'All appointments share one calendar, so a GiST exclusion constraint rejects overlapping slots in any branch atomically (SQLSTATE 23P01).' },
  follow_ups: { group: 'Scheduling', purpose: 'Follow-up due dates created when a consultation is finalized; linked to the appointment once booked.', access: BRANCH + ' No clinical notes.', retention: 'Kept with the clinical record.' },
  // Clinical
  consultations: { group: 'Clinical', purpose: 'A visit record (रुग्णपत्रिका): complaints, history, vitals, findings, assessment, diagnoses, plan, pathya/apathya, follow-up, and the branch that handled it.', access: CLINICAL, retention: CLINICAL_RETENTION + ' Finalized records are immutable.' },
  consultation_amendments: { group: 'Clinical', purpose: 'Dated, attributed addenda to a finalized consultation.', access: CLINICAL, retention: 'Append-only for the clinical retention period.' },
  ayurvedic_examinations: { group: 'Clinical', purpose: 'Structured and narrative Ayurvedic examination for one consultation, plus clinic-configured fields (`custom_fields`).', access: CLINICAL, retention: 'Locked with its consultation.', notes: 'All values are entered by the clinician. The software does not compute or validate diagnoses.' },
  exam_field_definitions: { group: 'Clinical', purpose: 'Clinic-configured examination fields (key, labels in English/Marathi, type, options).', access: 'Readable by every active account; edited with `settings.organization`.', retention: 'Deactivated, not deleted, so historical values stay interpretable.' },
  prescriptions: { group: 'Clinical', purpose: 'Prescription header: consultation, branch, language, instructions, follow-up, status, revision number.', access: CLINICAL + ' Drafts are visible only to the doctor.', retention: CLINICAL_RETENTION + ' Issued versions are preserved in `prescription_revisions`.' },
  prescription_items: { group: 'Clinical', purpose: 'Medicines on a prescription: form, route, dose, quantity, frequency, timing, anupana, duration, instructions (EN/MR).', access: CLINICAL, retention: 'Editable (and deletable) only while the prescription is a draft; each issued state is snapshotted.' },
  prescription_revisions: { group: 'Clinical', purpose: 'Immutable snapshot of each issued revision (header + items).', access: CLINICAL, retention: 'Append-only for the clinical retention period.' },
  prescription_templates: { group: 'Clinical', purpose: 'The doctor\'s reusable prescription templates.', access: 'Doctor only (`prescriptions.create`).', retention: 'Deactivated, not deleted.', notes: 'Templates are written by the doctor. Vaidyora never generates or recommends doses.' },
  investigations: { group: 'Clinical', purpose: 'Ordered tests and their results.', access: CLINICAL + ' Staff with `investigations.manage` may move the status, never the result.', retention: CLINICAL_RETENTION },
  // Billing
  invoices: { group: 'Billing', purpose: 'Invoice header with server-computed totals in paise and cached paid/refunded sums.', access: BRANCH + ' `billing.view`.', retention: FINANCE_RETENTION, notes: 'Intentional denormalisation: `amount_paid_paise` and `amount_refunded_paise` cache sums of payments/refunds. They are updated only by functions under a row lock.' },
  invoice_items: { group: 'Billing', purpose: 'Invoice lines (type, description, quantity, rate, GST rate, line and tax amounts).', access: 'As for the invoice.', retention: FINANCE_RETENTION },
  payments: { group: 'Billing', purpose: 'Payments against invoices, with method, reference, receipt number and reconciliation fields.', access: 'As for the invoice.', retention: FINANCE_RETENTION },
  refunds: { group: 'Billing', purpose: 'Refunds against invoices/payments, with reason and refund number.', access: 'As for the invoice.', retention: FINANCE_RETENTION + ' Immutable.' },
  // Cross-cutting
  audit_events: { group: 'Audit and notifications', purpose: 'Append-only security and change log: actor, action, event type, entity, branch, changed field names, non-PHI metadata (permission keys granted/revoked, status transitions).', access: '`audit.view`: doctor and admin see all; staff see their branches and their own actions.', retention: 'Kept for `clinic_settings.audit_retention_days` (default 8 years, minimum 3), then removed by `purge_expired_audit_events()` (service role only).' },
  notifications: { group: 'Audit and notifications', purpose: 'In-app notifications for a user (generic titles, no patient names).', access: 'Only the recipient.', retention: 'May be purged after 90 days (no clinical content).' },
};

export const SCHEMA_GROUP_ORDER = ['Organization', 'Identity and access', 'Patients', 'Scheduling', 'Clinical', 'Billing', 'Audit and notifications'];
