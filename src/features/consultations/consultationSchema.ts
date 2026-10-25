import { z } from 'zod';
import { optionalNumber, optionalText } from '@/lib/validation/schemas';
import { AGNIS, BALAS, DOSHAS, KOSHTHAS, PRAKRITIS, type AyurvedicExamination, type Consultation } from '@/types/domain';
import type { ConsultationInput, ExaminationInput } from '@/services/clinical';

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional().or(z.literal(''));

export const consultationSchema = z
  .object({
    chief_complaint: z.string().trim().min(1).max(2000),
    history_of_present_illness: optionalText(5000),
    past_history: optionalText(5000),
    pulse_bpm: optionalNumber(20, 250),
    bp_systolic: optionalNumber(50, 260),
    bp_diastolic: optionalNumber(30, 180),
    temperature_c: optionalNumber(30, 45),
    weight_kg: optionalNumber(0.5, 400),
    height_cm: optionalNumber(30, 260),
    spo2_percent: optionalNumber(50, 100),
    clinical_findings: optionalText(5000),
    diagnosis: optionalText(1000),
    ayurvedic_diagnosis: optionalText(1000),
    treatment_plan: optionalText(5000),
    pathya: optionalText(2000),
    apathya: optionalText(2000),
    follow_up_date: z.string().optional().or(z.literal('')),
    exam: z.object({
      prakriti: optionalEnum(PRAKRITIS),
      vikriti: z.array(z.enum(DOSHAS)),
      agni: optionalEnum(AGNIS),
      koshtha: optionalEnum(KOSHTHAS),
      bala: optionalEnum(BALAS),
      nadi: optionalText(500),
      mutra: optionalText(500),
      mala: optionalText(500),
      jihva: optionalText(500),
      shabda: optionalText(500),
      sparsha: optionalText(500),
      drik: optionalText(500),
      akriti: optionalText(500),
      sara: optionalText(500),
      satva: optionalText(500),
      notes: optionalText(3000),
    }),
  })
  .refine((v) => (v.bp_systolic === null) === (v.bp_diastolic === null), { path: ['bp_diastolic'], message: 'Enter both systolic and diastolic values.' })
  .refine((v) => v.bp_systolic === null || v.bp_diastolic === null || v.bp_systolic > v.bp_diastolic, { path: ['bp_diastolic'], message: 'Diastolic must be lower than systolic.' });

export type ConsultationFormInput = z.input<typeof consultationSchema>;
export type ConsultationFormValues = z.output<typeof consultationSchema>;

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function toConsultationForm(c?: Consultation | null, e?: AyurvedicExamination | null, patientPrakriti?: string | null): ConsultationFormInput {
  return {
    chief_complaint: c?.chief_complaint ?? '',
    history_of_present_illness: c?.history_of_present_illness ?? '',
    past_history: c?.past_history ?? '',
    pulse_bpm: str(c?.pulse_bpm),
    bp_systolic: str(c?.bp_systolic),
    bp_diastolic: str(c?.bp_diastolic),
    temperature_c: str(c?.temperature_c),
    weight_kg: str(c?.weight_kg),
    height_cm: str(c?.height_cm),
    spo2_percent: str(c?.spo2_percent),
    clinical_findings: c?.clinical_findings ?? '',
    diagnosis: c?.diagnosis ?? '',
    ayurvedic_diagnosis: c?.ayurvedic_diagnosis ?? '',
    treatment_plan: c?.treatment_plan ?? '',
    pathya: c?.pathya ?? '',
    apathya: c?.apathya ?? '',
    follow_up_date: c?.follow_up_date ?? '',
    exam: {
      prakriti: (e?.prakriti ?? patientPrakriti ?? '') as ConsultationFormInput['exam']['prakriti'],
      vikriti: e?.vikriti ?? [],
      agni: e?.agni ?? '',
      koshtha: e?.koshtha ?? '',
      bala: e?.bala ?? '',
      nadi: e?.nadi ?? '',
      mutra: e?.mutra ?? '',
      mala: e?.mala ?? '',
      jihva: e?.jihva ?? '',
      shabda: e?.shabda ?? '',
      sparsha: e?.sparsha ?? '',
      drik: e?.drik ?? '',
      akriti: e?.akriti ?? '',
      sara: e?.sara ?? '',
      satva: e?.satva ?? '',
      notes: e?.notes ?? '',
    },
  };
}

const nul = <T,>(v: T | '' | undefined): T | null => (v === '' || v === undefined ? null : v);

export function toConsultationPayload(
  v: ConsultationFormValues,
  ctx: { patient_id: string; doctor_id: string; appointment_id: string | null },
): { input: ConsultationInput; exam: ExaminationInput } {
  return {
    input: {
      patient_id: ctx.patient_id,
      doctor_id: ctx.doctor_id,
      appointment_id: ctx.appointment_id,
      chief_complaint: v.chief_complaint,
      history_of_present_illness: nul(v.history_of_present_illness),
      past_history: nul(v.past_history),
      pulse_bpm: v.pulse_bpm,
      bp_systolic: v.bp_systolic,
      bp_diastolic: v.bp_diastolic,
      temperature_c: v.temperature_c,
      weight_kg: v.weight_kg,
      height_cm: v.height_cm,
      spo2_percent: v.spo2_percent,
      clinical_findings: nul(v.clinical_findings),
      diagnosis: nul(v.diagnosis),
      ayurvedic_diagnosis: nul(v.ayurvedic_diagnosis),
      treatment_plan: nul(v.treatment_plan),
      pathya: nul(v.pathya),
      apathya: nul(v.apathya),
      follow_up_date: nul(v.follow_up_date),
    },
    exam: {
      prakriti: nul(v.exam.prakriti),
      vikriti: v.exam.vikriti,
      agni: nul(v.exam.agni),
      koshtha: nul(v.exam.koshtha),
      bala: nul(v.exam.bala),
      nadi: nul(v.exam.nadi),
      mutra: nul(v.exam.mutra),
      mala: nul(v.exam.mala),
      jihva: nul(v.exam.jihva),
      shabda: nul(v.exam.shabda),
      sparsha: nul(v.exam.sparsha),
      drik: nul(v.exam.drik),
      akriti: nul(v.exam.akriti),
      sara: nul(v.exam.sara),
      satva: nul(v.exam.satva),
      notes: nul(v.exam.notes),
    },
  };
}

/** BMI from weight (kg) and height (cm); null when either is missing. */
export function computeBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}
