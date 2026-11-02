import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ErrorState, FullPageSpinner } from '@/components/feedback/States';
import { Button } from '@/components/ui/Button';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { toUserMessage } from '@/lib/errors';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { PrescriptionDocument } from './PrescriptionDocument';
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

  return (
    <div className="min-h-dvh bg-ivory px-4 py-6 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end gap-2">
        {rx.data.status !== 'issued' && <p className="mr-auto text-sm text-warning">{t(`prescriptionStatus.${rx.data.status}`)}</p>}
        <Button leftIcon={<Printer className="size-4" />} onClick={() => window.print()}>
          {t('common.print')}
        </Button>
      </div>
      <PrescriptionDocument clinic={clinic} rx={rx.data} patient={patient.data} doctor={doctor.data} consultation={consult.data?.consultation} />
    </div>
  );
}
