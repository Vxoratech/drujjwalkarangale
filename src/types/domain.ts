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
  clinic: Pick<Clinic, 'id' | 'name' | 'city' | 'logo_path'>;
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
  archived_at: Timestamp | null;
  created_at: Timestamp;
}

export const APPOINTMENT_TYPES = ['new_visit', 'follow_up', 'panchakarma', 'teleconsultation'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export const APPOINTMENT_STATUSES = ['scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

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
  cancellation_reason: string | null;
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
  notes: string | null;
}

export type PrescriptionStatus = 'draft' | 'issued' | 'cancelled';
export const MEDICINE_FORMS = ['churna', 'vati', 'kashaya', 'arishta_asava', 'ghrita', 'taila', 'bhasma', 'lehya', 'syrup', 'other'] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];
export const DOSE_TIMINGS = ['before_food', 'after_food', 'with_food', 'empty_stomach', 'bedtime', 'as_directed'] as const;
export type DoseTiming = (typeof DOSE_TIMINGS)[number];

export interface PrescriptionItem {
  id: UUID;
  prescription_id: UUID;
  position: number;
  medicine_name: string;
  form: MedicineForm;
  dose: string;
  frequency: string;
  timing: DoseTiming;
  anupana: string | null;
  duration_days: number | null;
  instructions: string | null;
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
  issued_at: Timestamp | null;
  created_at: Timestamp;
  items: PrescriptionItem[];
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
  result_file_path: string | null;
  ordered_at: Timestamp;
  resulted_at: Timestamp | null;
}

export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'void';
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
  notes: string | null;
  void_reason: string | null;
  created_at: Timestamp;
  patient: Pick<Patient, 'id' | 'first_name' | 'last_name' | 'patient_code' | 'phone'> | null;
}

export interface InvoiceDetail extends Invoice {
  items: InvoiceItem[];
  payments: Payment[];
}

export interface AuditLog {
  id: number;
  clinic_id: UUID;
  actor_id: UUID | null;
  action: 'insert' | 'update' | 'delete';
  entity_type: string;
  entity_id: UUID | null;
  changed_fields: string[];
  created_at: Timestamp;
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
  invoice_count: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
}
