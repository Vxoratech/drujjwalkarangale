import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ErrorState, FullPageSpinner } from '@/components/feedback/States';
import { PrintableDocument } from '@/components/data-display/PrintableDocument';
import { Button } from '@/components/ui/Button';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { toUserMessage } from '@/lib/errors';
import { ageLabel, formatDate, fullName } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { en } from '@/locales/en';
import { translate, useI18n, type TranslationKey } from '@/locales/i18n';
import { mr } from '@/locales/mr';
import type { PrescriptionItem } from '@/types/domain';
import { getConsultation, getPrescription } from '@/services/clinical';
import { fetchProfile } from '@/services/clinic';
import { getPatient } from '@/services/patients';

export function PrescriptionPrintPage() {
  const { prescriptionId = '' } = useParams();
  const { t } = useI18n();
  const { clinicId, clinic } = useClinic();
  const rx = useQuery({ queryKey: qk.prescription(clinicId, prescriptionId), queryFn: () => getPrescription(clinicId, prescriptionId) });
  const patient = useQuery({ queryKey: qk.patient(clinicId, rx.data?.patient_id ?? ''), queryFn: () => getPatient(clinicId, rx.data!.patient_id), enabled: Boolean(rx.data) });
  const doctor = useQuery({ queryKey: qk.profile(rx.data?.doctor_id ?? ''), queryFn: () => fetchProfile(rx.data!.doctor_id), enabled: Boolean(rx.data) });
  const consult = useQuery({
    queryKey: qk.consultation(clinicId, rx.data?.consultation_id ?? ''),
    queryFn: () => getConsultation(clinicId, rx.data!.consultation_id!),
    enabled: Boolean(rx.data?.consultation_id),
  });

  if (rx.isLoading || patient.isLoading) return <FullPageSpinner />;
  if (rx.isError || patient.isError || !rx.data || !patient.data) return <ErrorState message={toUserMessage(rx.error ?? patient.error)} />;
  const p = patient.data;
  const age = ageLabel(p);
  const c = consult.data?.consultation;
  // The prescription prints in its own language, independent of the UI language.
  const dict = rx.data.language === 'mr' ? mr : en;
  const printT = (key: TranslationKey, params?: Record<string, string | number>) => translate(dict, key, params);
  const instructionFor = (i: PrescriptionItem) => (rx.data.language === 'mr' ? i.instructions_mr || i.instructions_en : i.instructions_en || i.instructions_mr);

  return (
    <div className="min-h-dvh bg-ivory px-4 py-6 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end gap-2">
        {rx.data.status !== 'issued' && <p className="mr-auto text-sm text-warning">{t(`prescriptionStatus.${rx.data.status}`)}</p>}
        <Button leftIcon={<Printer className="size-4" />} onClick={() => window.print()}>
          {t('common.print')}
        </Button>
      </div>
      <PrintableDocument
        clinic={clinic}
        title={printT('prescriptions.title')}
        meta={
          <span className="tabular">
            {rx.data.prescription_no ?? '—'}
            {rx.data.revision_number > 1 && ` (${printT('prescriptions.revisionN', { n: rx.data.revision_number })})`} · {formatDate(rx.data.issued_at ?? rx.data.created_at)}
          </span>
        }
        footer={
          <div className="flex items-end justify-between gap-6">
            <div>
              {(rx.data.follow_up_date ?? c?.follow_up_date) && (
                <p>
                  {printT('consultations.followUp')}: <span className="tabular font-medium text-ink">{formatDate(rx.data.follow_up_date ?? c?.follow_up_date)}</span>
                </p>
              )}
            </div>
            <div className="text-right">
              <div className="mb-1 h-10 w-48 border-b border-line-strong" aria-hidden />
              <p className="font-medium text-ink">{doctor.data?.full_name}</p>
              <p>{[doctor.data?.qualification, doctor.data?.medical_registration_no && `Reg. ${doctor.data.medical_registration_no}`].filter(Boolean).join(' · ')}</p>
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
            {rx.data.items.map((i, idx) => (
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
        {rx.data.patient_instructions && <p className="mt-4 whitespace-pre-line text-xs">{rx.data.patient_instructions}</p>}
      </PrintableDocument>
    </div>
  );
}
