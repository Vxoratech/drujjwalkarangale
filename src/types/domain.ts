/**
 * Domain types mirroring the Postgres schema in supabase/migrations.
 * Regenerate full database types with `npm run db:types` once a local stack
 * is running; these hand-written types define the app's service contracts.
 */

export type UUID = string;
/** ISO-8601 timestamp with zone, as returned by PostgREST. */
export type Timestamp = string;
/** YYYY-MM-DD calendar date. */
export type DateString = string;
/** Integer amount in paise (1 INR = 100 paise). */
export type Paise = number;

export const APP_ROLES = ['super_admin', 'admin', 'doctor', 'receptionist', 'accountant', 'pharmacist', 'branch_manager'] as const;
export type AppRole = (typeof APP_ROLES)[number];
/** Roles that can be assigned from the UI today. Others are provisioned but not yet enabled. */
export const ASSIGNABLE_ROLES = ['admin', 'doctor'] as const satisfies readonly AppRole[];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export type MemberStatus = 'active' | 'invited' | 'suspended';
export type Locale = 'en' | 'mr';
export type ClinicStatus = 'active' | 'suspended' | 'closed';

export interface Clinic {
  id: UUID;
  name: string;
  legal_name: string | null;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  registration_no: string | null;
  logo_path: string | null;
  timezone: string;
  currency: string;
  default_locale: Locale;
  invoice_prefix: string;
  consultation_fee_paise: Paise;
  status: ClinicStatus;
  status_reason: string | null;
  brand_accent: string | null;
  audit_retention_days: number;
  settings: ClinicSettings;
}

export interface Branch {
  id: UUID;
  clinic_id: UUID;
  name: string;
  address_line: string | null;
  city: string | null;
  phone: string | null;
  is_primary: boolean;
  is_active: boolean;
}

export interface Profile {
  id: UUID;
  full_name: string;
  phone: string | null;
  preferred_locale: Locale;
  qualification: string | null;
  medical_registration_no: string | null;
}

export interface Membership {
  id: UUID;
  clinic_id: UUID;
  user_id: UUID;
  roles: AppRole[];
  status: MemberStatus;
  default_branch_id: UUID | null;
  clinic: Pick<Clinic, 'id' | 'name' | 'city' | 'logo_path' | 'status' | 'status_reason'> | null;
}

export interface StaffMember {
  id: UUID;
  clinic_id: UUID;
  user_id: UUID;
  roles: AppRole[];
  status: MemberStatus;
  created_at: Timestamp;
  profile: Pick<Profile, 'full_name' | 'phone' | 'qualification'> | null;
}

export type Gender = 'female' | 'male' | 'other' | 'undisclosed';
export const DOSHAS = ['vata', 'pitta', 'kapha'] as const;
export type Dosha = (typeof DOSHAS)[number];
export const PRAKRITIS = ['vata', 'pitta', 'kapha', 'vata_pitta', 'pitta_kapha', 'vata_kapha', 'sama'] as const;
export type Prakriti = (typeof PRAKRITIS)[number];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export interface Patient {
  id: UUID;
  clinic_id: UUID;
  branch_id: UUID | null;
  patient_code: string;
  first_name: string;
  last_name: string;
  date_of_birth: DateString | null;
  gender: Gender;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  city: string | null;
  blood_group: BloodGroup | null;
  allergies: string | null;
  chronic_conditions: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  prakriti: Prakriti | null;
  assigned_doctor_id: UUID | null;
  preferred_locale: Locale;
  status: PatientStatus;
  occupation: string | null;
  approx_age_years: number | null;
  registered_on: DateString;
  created_at: Timestamp;
}

export const PATIENT_STATUSES = ['active', 'inactive', 'deceased'] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

export const CONSENT_TYPES = ['treatment', 'data_processing', 'sms_reminders', 'whatsapp_reminders', 'clinical_photography'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];
export const CONSENT_METHODS = ['verbal', 'written', 'digital'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export interface PatientConsent {
  id: UUID;
  patient_id: UUID;
  consent_type: ConsentType;
  status: 'granted' | 'withdrawn';
  method: ConsentMethod;
  policy_version: string;
  notes: string | null;
  granted_at: Timestamp;
  recorded_by: UUID;
  withdrawn_at: Timestamp | null;
}

export const APPOINTMENT_TYPES = ['new_visit', 'follow_up', 'panchakarma', 'teleconsultation'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export const APPOINTMENT_STATUSES = ['scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_SOURCES = ['walk_in', 'phone', 'online', 'referral', 'follow_up', 'other'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export interface Appointment {
  id: UUID;
  clinic_id: UUID;
  branch_id: UUID | null;
  patient_id: UUID;
  doctor_id: UUID;
  starts_at: Timestamp;
  ends_at: Timestamp;
  type: AppointmentType;
  status: AppointmentStatus;
  reason: string | null;
  source: AppointmentSource;
  notes: string | null;
  cancellation_reason: string | null;
  cancelled_at: Timestamp | null;
}

export interface AppointmentWithPatient extends Appointment {
  patient: Pick<Patient, 'id' | 'first_name' | 'last_name' | 'patient_code' | 'phone'> | null;
}

export type RecordStatus = 'draft' | 'finalized';
export const AGNIS = ['sama', 'vishama', 'tikshna', 'manda'] as const;
export type Agni = (typeof AGNIS)[number];
export const KOSHTHAS = ['mridu', 'madhyama', 'krura'] as const;
export type Koshtha = (typeof KOSHTHAS)[number];
export const BALAS = ['pravara', 'madhyama', 'avara'] as const;
export type Bala = (typeof BALAS)[number];

export interface Consultation {
  id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  doctor_id: UUID;
  appointment_id: UUID | null;
  branch_id: UUID | null;
  status: RecordStatus;
  visit_date: DateString;
  chief_complaint: string;
  history_of_present_illness: string | null;
  past_history: string | null;
  pulse_bpm: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  temperature_c: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  spo2_percent: number | null;
  clinical_findings: string | null;
  pain_details: string | null;
  doctor_notes: string | null;
  assessment: string | null;
  diagnosis: string | null;
  ayurvedic_diagnosis: string | null;
  treatment_plan: string | null;
  pathya: string | null;
  apathya: string | null;
  follow_up_date: DateString | null;
  finalized_at: Timestamp | null;
  created_at: Timestamp;
}

export interface AyurvedicExamination {
  id: UUID;
  clinic_id: UUID;
  consultation_id: UUID;
  patient_id: UUID;
  prakriti: Prakriti | null;
  vikriti: Dosha[];
  agni: Agni | null;
  koshtha: Koshtha | null;
  bala: Bala | null;
  nadi: string | null;
  mutra: string | null;
  mala: string | null;
  jihva: string | null;
  shabda: string | null;
  sparsha: string | null;
  drik: string | null;
  akriti: string | null;
  sara: string | null;
  satva: string | null;
  vata_score: number | null;
  pitta_score: number | null;
  kapha_score: number | null;
  ama: AmaLevel | null;
  nidra: string | null;
  appetite: string | null;
  digestion: string | null;
  bowel_habits: string | null;
  dinacharya: string | null;
  lifestyle: string | null;
  general_examination: string | null;
  family_history: string | null;
  family_history_maternal: string | null;
  family_history_paternal: string | null;
  family_history_self: string | null;
  menstrual_history: string | null;
  custom_fields: Record<string, string | number | boolean | null>;
  notes: string | null;
}

export const AMA_LEVELS = ['absent', 'mild', 'moderate', 'severe'] as const;
export type AmaLevel = (typeof AMA_LEVELS)[number];

export interface ExamFieldDefinition {
  id: UUID;
  clinic_id: UUID;
  key: string;
  label_en: string;
  label_mr: string | null;
  field_type: 'text' | 'number' | 'select' | 'boolean';
  options: string[] | null;
  unit: string | null;
  position: number;
  is_active: boolean;
}

export type FollowUpStatus = 'pending' | 'booked' | 'completed' | 'cancelled';
export interface FollowUp {
  id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  doctor_id: UUID;
  consultation_id: UUID | null;
  appointment_id: UUID | null;
  due_date: DateString;
  reason: string | null;
  status: FollowUpStatus;
  patient: Pick<Patient, 'id' | 'first_name' | 'last_name' | 'patient_code' | 'phone'> | null;
}

export type PrescriptionStatus = 'draft' | 'issued' | 'cancelled';
export const MEDICINE_FORMS = ['churna', 'vati', 'kashaya', 'arishta_asava', 'ghrita', 'taila', 'bhasma', 'lehya', 'syrup', 'other'] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];
export const DOSE_TIMINGS = ['before_food', 'after_food', 'with_food', 'empty_stomach', 'bedtime', 'as_directed'] as const;
export type DoseTiming = (typeof DOSE_TIMINGS)[number];
export const MEDICINE_ROUTES = ['oral', 'topical', 'nasal', 'rectal', 'ophthalmic', 'otic', 'other'] as const;
export type MedicineRoute = (typeof MEDICINE_ROUTES)[number];

export interface PrescriptionItem {
  id: UUID;
  prescription_id: UUID;
  position: number;
  medicine_name: string;
  form: MedicineForm;
  route: MedicineRoute;
  dose: string;
  quantity: string | null;
  frequency: string;
  timing: DoseTiming;
  anupana: string | null;
  duration_days: number | null;
  instructions_en: string | null;
  instructions_mr: string | null;
}

export interface Prescription {
  id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  doctor_id: UUID;
  consultation_id: UUID | null;
  prescription_no: string | null;
  status: PrescriptionStatus;
  notes: string | null;
  language: Locale;
  patient_instructions: string | null;
  follow_up_date: DateString | null;
  revision_number: number;
  revision_reason: string | null;
  issued_at: Timestamp | null;
  created_at: Timestamp;
  items: PrescriptionItem[];
}

export interface PrescriptionRevision {
  id: UUID;
  prescription_id: UUID;
  revision_number: number;
  revision_reason: string | null;
  issued_by: UUID;
  issued_at: Timestamp;
  snapshot: { header: Omit<Prescription, 'items'>; items: PrescriptionItem[] };
}

export interface PrescriptionTemplate {
  id: UUID;
  clinic_id: UUID;
  owner_id: UUID;
  name: string;
  description: string | null;
  items: Partial<PrescriptionItem>[];
  patient_instructions: string | null;
  is_shared: boolean;
  is_active: boolean;
}

export type InvestigationStatus = 'ordered' | 'sample_collected' | 'resulted' | 'cancelled';
export type InvestigationCategory = 'laboratory' | 'imaging' | 'other';

export interface Investigation {
  id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  consultation_id: UUID | null;
  ordered_by: UUID;
  test_name: string;
  category: InvestigationCategory;
  status: InvestigationStatus;
  instructions: string | null;
  result_summary: string | null;
  notes: string | null;
  ordered_at: Timestamp;
  resulted_at: Timestamp | null;
}

export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'refunded' | 'void';

export const DOCUMENT_CATEGORIES = ['lab_report', 'imaging', 'external_prescription', 'consent_form', 'clinical_photo', 'other'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export interface PatientDocument {
  id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  investigation_id: UUID | null;
  consultation_id: UUID | null;
  category: DocumentCategory;
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_by: UUID;
  uploaded_at: Timestamp | null;
  created_at: Timestamp;
}
export const INVOICE_ITEM_TYPES = ['consultation', 'procedure', 'panchakarma', 'medicine', 'investigation', 'other'] as const;
export type InvoiceItemType = (typeof INVOICE_ITEM_TYPES)[number];
export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface InvoiceItem {
  id: UUID;
  position: number;
  item_type: InvoiceItemType;
  description: string;
  quantity: number;
  unit_price_paise: Paise;
  tax_rate: number;
  line_total_paise: Paise;
  tax_paise: Paise;
}

export interface Payment {
  id: UUID;
  invoice_id: UUID;
  patient_id: UUID;
  amount_paise: Paise;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  paid_at: Timestamp;
  received_by: UUID | null;
  receipt_no: string | null;
  settlement_reference: string | null;
  reconciliation_note: string | null;
  reconciled_at: Timestamp | null;
  reconciled_by: UUID | null;
}

export interface PaymentWithContext extends Payment {
  invoice: Pick<Invoice, 'id' | 'invoice_no'> | null;
  patient: Pick<Patient, 'id' | 'first_name' | 'last_name' | 'patient_code'> | null;
}

export interface ConsultationAmendment {
  id: UUID;
  consultation_id: UUID;
  author_id: UUID;
  reason: string;
  content: string;
  created_at: Timestamp;
}

export interface AccessReview {
  id: UUID;
  reviewer_id: UUID;
  member_count: number;
  changes_made: boolean;
  notes: string | null;
  reviewed_at: Timestamp;
}

export interface ClinicSettings {
  bilingual_labels?: boolean;
  default_appointment_minutes?: number;
  prescription_language?: 'patient' | 'en' | 'mr';
  /** Optional consultation sections; absent = shown. */
  consultation_sections?: Partial<Record<ConsultationSection, boolean>>;
  /** Set by trusted seed/platform code only. */
  demo?: boolean;
}

export const CONSULTATION_SECTIONS = ['pain', 'family_history', 'menstrual_history', 'dinacharya', 'general_examination', 'dosha_assessment', 'clinic_fields'] as const;
export type ConsultationSection = (typeof CONSULTATION_SECTIONS)[number];

export interface ClinicOverview {
  patients_total: number;
  patients_new: number;
  appointments_today: number;
  appointments_in_range: number;
  appointments_no_show: number;
  consultations_completed: number;
  consultations_open: number;
  follow_ups_pending: number;
  follow_ups_overdue: number;
  collected_paise: Paise;
  refunded_paise: Paise;
  outstanding_paise: Paise;
  unreconciled_payments: number;
}

export interface TrendRow {
  period: DateString;
  new_patients: number;
  appointments: number;
  appointments_completed: number;
  consultations_completed: number;
  collected_paise: Paise;
}

export interface BranchMetric {
  branch_id: UUID;
  branch_name: string;
  appointments: number;
  appointments_completed: number;
  no_shows: number;
  consultations_completed: number;
  invoiced_paise: Paise;
  collected_paise: Paise;
  outstanding_paise: Paise;
}

export interface DoctorOverview {
  appointments_today: number;
  waiting: number;
  in_progress: number;
  completed_today: number;
  completed_this_month: number;
  follow_ups_due: number;
}

export interface RecentPatient {
  patient_id: UUID;
  first_name: string;
  last_name: string;
  patient_code: string;
  last_viewed_at: Timestamp;
}

export interface Refund {
  id: UUID;
  invoice_id: UUID;
  payment_id: UUID | null;
  refund_no: string;
  amount_paise: Paise;
  method: PaymentMethod;
  reference: string | null;
  reason: string;
  refunded_at: Timestamp;
}

export interface Invoice {
  id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  appointment_id: UUID | null;
  invoice_no: string;
  status: InvoiceStatus;
  issue_date: DateString;
  subtotal_paise: Paise;
  tax_paise: Paise;
  discount_paise: Paise;
  total_paise: Paise;
  amount_paid_paise: Paise;
  amount_refunded_paise: Paise;
  notes: string | null;
  void_reason: string | null;
  created_at: Timestamp;
  patient: Pick<Patient, 'id' | 'first_name' | 'last_name' | 'patient_code' | 'phone'> | null;
}

export interface InvoiceDetail extends Invoice {
  items: InvoiceItem[];
  payments: Payment[];
  refunds: Refund[];
}

export type AuditAction = 'insert' | 'update' | 'delete' | 'view' | 'access' | 'security';
export interface AuditEvent {
  id: number;
  clinic_id: UUID | null;
  actor_id: UUID | null;
  actor_type: 'user' | 'platform' | 'system';
  action: AuditAction;
  event_type: string;
  entity_type: string;
  entity_id: UUID | null;
  changed_fields: string[];
  metadata: Record<string, unknown>;
  created_at: Timestamp;
}

export interface SubscriptionPlan {
  id: UUID;
  code: string;
  name: string;
  price_paise: Paise;
  billing_interval: 'monthly' | 'yearly';
  limits: { max_doctors?: number; max_branches?: number; max_staff?: number };
}

export interface TenantSubscription {
  id: UUID;
  clinic_id: UUID;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
  billing_interval: 'monthly' | 'yearly';
  trial_ends_at: Timestamp | null;
  current_period_end: Timestamp | null;
  provider: 'manual' | 'razorpay' | 'stripe';
  plan: SubscriptionPlan | null;
}

export interface AppNotification {
  id: UUID;
  clinic_id: UUID;
  kind: 'appointment_booked' | 'appointment_cancelled' | 'investigation_resulted' | 'system';
  title: string;
  link: string | null;
  read_at: Timestamp | null;
  created_at: Timestamp;
}

export interface DashboardSummary {
  appointments_today: number;
  appointments_remaining_today: number;
  patients_total: number;
  patients_new_this_month: number;
  collected_this_month_paise: Paise;
  outstanding_paise: Paise;
  draft_consultations: number;
  follow_ups_next_7_days: number;
  pending_investigations: number;
}

export interface RevenueRow {
  day: DateString;
  invoiced_paise: Paise;
  collected_paise: Paise;
  refunded_paise: Paise;
  invoice_count: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
}
