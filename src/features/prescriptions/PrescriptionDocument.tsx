import { PrintableDocument } from '@/components/data-display/PrintableDocument';
import { ageLabel, formatDate, fullName } from '@/lib/formatters';
import { en } from '@/locales/en';
import { translate, type TranslationKey } from '@/locales/i18n';
import { mr } from '@/locales/mr';
import type { Clinic, Consultation, Patient, Prescription, PrescriptionItem, Profile } from '@/types/domain';

export interface PrescriptionDocumentProps {
  clinic: Clinic;
  rx: Prescription;
  patient: Patient;
  doctor: Pick<Profile, 'full_name' | 'qualification' | 'medical_registration_no'> | null | undefined;
  consultation?: Consultation | null;
}

/**
 * The A4 prescription, rendered in the prescription's own language
 * (independent of the UI language). Pure: all data comes from props.
 */
export function PrescriptionDocument({ clinic, rx, patient: p, doctor, consultation: c }: PrescriptionDocumentProps) {
  const age = ageLabel(p);
  const dict = rx.language === 'mr' ? mr : en;
  const printT = (key: TranslationKey, params?: Record<string, string | number>) => translate(dict, key, params);
  // Clinician-written text is never translated; fall back to the other language only if one is empty.
  const instructionFor = (i: PrescriptionItem) => (rx.language === 'mr' ? i.instructions_mr || i.instructions_en : i.instructions_en || i.instructions_mr);

  return (
        <PrintableDocument
          language={rx.language}
          clinic={clinic}
          title={printT('prescriptions.title')}
          meta={
            <span className="tabular">
              {rx.prescription_no ?? '—'}
              {rx.revision_number > 1 && ` (${printT('prescriptions.revisionN', { n: rx.revision_number })})`} · {formatDate(rx.issued_at ?? rx.created_at)}
            </span>
          }
          footer={
            <div className="flex items-end justify-between gap-6">
              <div>
                {(rx.follow_up_date ?? c?.follow_up_date) && (
                  <p>
                    {printT('consultations.followUp')}: <span className="tabular font-medium text-ink">{formatDate(rx.follow_up_date ?? c?.follow_up_date)}</span>
                  </p>
                )}
              </div>
              <div className="text-right">
                <div className="mb-1 h-10 w-48 border-b border-line-strong" aria-hidden />
                <p className="font-medium text-ink">{doctor?.full_name}</p>
                <p>{[doctor?.qualification, doctor?.medical_registration_no && `Reg. ${doctor.medical_registration_no}`].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          }
        >
          <section className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-ivory px-4 py-3 text-xs sm:grid-cols-4 print:bg-[#f7f5ef]">
            <p>
              <span className="text-ink-muted">{printT('patients.name')}: </span>
              <span className="font-medium">{fullName(p)}</span>
            </p>
            <p>
              <span className="text-ink-muted">{printT('patients.code')}: </span>
              <span className="tabular">{p.patient_code}</span>
            </p>
            <p>
              <span className="text-ink-muted">{printT('patients.age')}: </span>
              {age ?? '—'} · {printT(`gender.${p.gender}`)}
            </p>
            {c?.weight_kg && (
              <p>
                <span className="text-ink-muted">{printT('consultations.weight')}: </span>
                <span className="tabular">{c.weight_kg}</span>
              </p>
            )}
          </section>
          {(c?.ayurvedic_diagnosis || c?.diagnosis) && (
            <p className="mt-4 text-xs">
              <span className="font-medium">{printT('consultations.ayurvedicDiagnosis')}: </span>
              {[c.ayurvedic_diagnosis, c.diagnosis].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="mt-5 font-display text-2xl font-semibold text-forest" aria-hidden>
            ℞
          </p>
          <table className="mt-2 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-line-strong text-left text-ink-muted">
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">{printT('prescriptions.medicine')}</th>
                <th className="py-2 pr-2 font-medium">{printT('prescriptions.dose')}</th>
                <th className="py-2 pr-2 font-medium">{printT('prescriptions.frequency')}</th>
                <th className="py-2 pr-2 font-medium">{printT('prescriptions.anupana')}</th>
                <th className="py-2 font-medium">{printT('prescriptions.duration')}</th>
              </tr>
            </thead>
            <tbody>
              {rx.items.map((i, idx) => (
                <tr key={i.id} className="border-b border-line align-top">
                  <td className="tabular py-2 pr-2">{idx + 1}</td>
                  <td className="py-2 pr-2">
                    <p className="font-medium text-ink">{i.medicine_name}</p>
                    <p className="text-ink-muted">
                      {printT(`medicineForm.${i.form}`)} · {printT(`medicineRoute.${i.route}`)} · {printT(`doseTiming.${i.timing}`)}
                      {i.quantity && ` · ${printT('prescriptions.quantity')}: ${i.quantity}`}
                    </p>
                    {instructionFor(i) && <p className="text-ink-muted">{instructionFor(i)}</p>}
                  </td>
                  <td className="py-2 pr-2">{i.dose}</td>
                  <td className="py-2 pr-2">{i.frequency}</td>
                  <td className="py-2 pr-2">{i.anupana ?? '—'}</td>
                  <td className="tabular py-2">{i.duration_days ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(c?.pathya || c?.apathya) && (
            <div className="mt-5 grid gap-4 text-xs sm:grid-cols-2">
              {c.pathya && (
                <div>
                  <p className="font-medium text-forest-deep">{printT('consultations.pathya')}</p>
                  <p className="whitespace-pre-line">{c.pathya}</p>
                </div>
              )}
              {c.apathya && (
                <div>
                  <p className="font-medium text-forest-deep">{printT('consultations.apathya')}</p>
                  <p className="whitespace-pre-line">{c.apathya}</p>
                </div>
              )}
            </div>
          )}
          {rx.patient_instructions && <p className="mt-4 whitespace-pre-line text-xs">{rx.patient_instructions}</p>}
        </PrintableDocument>
  );
}
