/**
 * Fictional records for tests and the dev-only fixture pages. Never real people.
 */
import type { Branch, Consultation, Organization, Patient, Prescription, PrescriptionItem } from '@/types/domain';

export const fixtureOrganization: Organization = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Dr. Ujjwal Karangale Ayurvedic Clinic (Demo)',
  legal_name: 'Karangale Ayurveda Wellness LLP (Demo)',
  phone: '+91 20 4000 1234',
  email: 'clinic@demo.vaidyora.test',
  address_line: '12, Shanti Nagar, Kothrud',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411038',
  gstin: '27ABCDE1234F1Z5',
  registration_no: 'MH-AYU-0000 (Demo)',
  logo_path: null,
  primary_doctor_id: '00000000-0000-4000-8000-000000000201',
};

export const fixtureBranch: Branch = {
  id: '00000000-0000-4000-8000-000000000011',
  code: 'MAIN',
  name: 'Main Clinic',
  address_line: '12, Shanti Nagar, Kothrud',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411038',
  phone: '+91 20 4000 1234',
  email: null,
  is_primary: true,
  is_active: true,
  manager_staff_id: null,
};

export const fixturePatient: Patient = {
  id: '00000000-0000-4000-8000-000000000101',
  registered_branch_id: fixtureBranch.id,
  patient_code: 'P-000001',
  first_name: 'Sunita',
  last_name: 'Pawar',
  date_of_birth: '1978-04-12',
  gender: 'female',
  phone: '+91 98220 10001',
  email: null,
  address_line: 'Flat 4, Sai Residency',
  city: 'Pune',
  emergency_contact_name: null,
  emergency_contact_phone: null,
  preferred_locale: 'mr',
  status: 'active',
  occupation: 'Teacher',
  approx_age_years: null,
  registered_on: '2026-09-01',
  duplicate_reviewed: false,
  created_at: '2026-09-01T05:00:00Z',
};

export const fixtureConsultation: Consultation = {
  id: '00000000-0000-4000-8000-000000000301',
  patient_id: fixturePatient.id,
  appointment_id: null,
  branch_id: fixtureBranch.id,
  status: 'finalized',
  visit_date: '2026-10-22',
  chief_complaint: 'Bilateral knee pain for 3 months',
  history_of_present_illness: null,
  past_history: null,
  pulse_bpm: 76,
  bp_systolic: 128,
  bp_diastolic: 82,
  temperature_c: null,
  weight_kg: 68,
  height_cm: 158,
  spo2_percent: null,
  clinical_findings: null,
  pain_details: null,
  doctor_notes: 'Private note — must never print.',
  assessment: null,
  diagnosis: 'Primary osteoarthritis, both knees',
  ayurvedic_diagnosis: 'Sandhigata Vata',
  treatment_plan: null,
  pathya: 'Warm, freshly cooked food; sesame oil; gentle walking',
  apathya: 'Cold food, curd at night, prolonged fasting',
  follow_up_date: '2026-11-21',
  consultation_fee_paise: 50000,
  invoice_id: null,
  finalized_at: '2026-10-22T06:00:00Z',
  created_at: '2026-10-22T05:00:00Z',
};

const medicines: [string, PrescriptionItem['form'], PrescriptionItem['route']][] = [
  ['Yogaraj Guggulu', 'vati', 'oral'],
  ['Dashamoola Kashaya', 'kashaya', 'oral'],
  ['Mahanarayan Taila', 'taila', 'topical'],
  ['Ashwagandha Churna', 'churna', 'oral'],
  ['Triphala Churna', 'churna', 'oral'],
  ['Rasnadi Guggulu', 'vati', 'oral'],
  ['Shatavari Churna', 'churna', 'oral'],
  ['Punarnavadi Mandur', 'vati', 'oral'],
  ['Anu Taila', 'taila', 'nasal'],
  ['Kaishore Guggulu', 'vati', 'oral'],
  ['Brahmi Ghrita', 'ghrita', 'oral'],
  ['Chyavanprash', 'lehya', 'oral'],
  ['Arjunarishta', 'arishta_asava', 'oral'],
  ['Pinda Taila', 'taila', 'topical'],
];

/** A long prescription: 14 items with long bilingual instructions (pagination test). */
export function fixturePrescription(language: 'en' | 'mr' = 'mr', count = medicines.length): Prescription {
  return {
    id: '00000000-0000-4000-8000-000000000401',
    patient_id: fixturePatient.id,
    consultation_id: fixtureConsultation.id,
    branch_id: fixtureBranch.id,
    prescription_no: 'RX-2026-000014',
    status: 'issued',
    notes: 'Internal note — must never print.',
    language,
    patient_instructions: 'थंड पेये टाळा. रोज सकाळी हलके चालणे. Avoid cold drinks; walk gently every morning.',
    follow_up_date: '2026-11-21',
    consultation_fee_paise: null, // billed with the consultation
    invoice_id: null,
    revision_number: 2,
    revision_reason: 'Dose adjusted',
    issued_at: '2026-10-22T06:10:00Z',
    created_at: '2026-10-22T05:30:00Z',
    items: medicines.slice(0, count).map(([name, form, route], i) => ({
      id: `item-${i}`,
      prescription_id: '00000000-0000-4000-8000-000000000401',
      position: i,
      medicine_name: name,
      form,
      route,
      dose: i % 2 ? '3 g' : '2 tablets',
      quantity: i % 3 ? null : '60 tablets',
      frequency: 'Twice daily',
      timing: i % 2 ? 'before_food' : 'after_food',
      anupana: i % 2 ? 'Lukewarm water' : 'Warm milk',
      duration_days: 30,
      instructions_en: 'Take with lukewarm water after meals; stop and inform the doctor if you notice acidity, rash or loose stools.',
      instructions_mr: 'जेवणानंतर कोमट पाण्यासोबत घ्या; पित्त, पुरळ किंवा जुलाब झाल्यास औषध थांबवून डॉक्टरांना कळवा.',
    })),
  };
}

export const fixtureDoctor = { full_name: 'Dr. Ujjwal Karangale', qualification: 'BAMS, MD (Kayachikitsa)', medical_registration_no: 'I-00000-A (Demo)' };
