import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ErrorState, FullPageSpinner } from '@/components/feedback/States';
import { Button } from '@/components/ui/Button';
import { useAccess } from '@/features/access/AccessProvider';
import { toUserMessage } from '@/lib/errors';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { PrescriptionDocument } from './PrescriptionDocument';
import { getConsultation, getPrescription } from '@/services/clinical';
import { fetchPrimaryDoctor } from '@/services/organization';
import { useBranches } from '@/hooks/useBranches';
import { getPatient } from '@/services/patients';

export function PrescriptionPrintPage() {
  const { prescriptionId = '' } = useParams();
  const { t } = useI18n();
  const { organization } = useAccess();
  const { byId } = useBranches();
  const rx = useQuery({ queryKey: qk.prescription(prescriptionId), queryFn: () => getPrescription(prescriptionId) });
  const patient = useQuery({ queryKey: qk.patient(rx.data?.patient_id ?? ''), queryFn: () => getPatient(rx.data!.patient_id), enabled: Boolean(rx.data) });
  // Every prescription is Dr. Ujjwal's: the primary doctor signs it.
  const doctor = useQuery({ queryKey: ['primary-doctor'], queryFn: fetchPrimaryDoctor, staleTime: 30 * 60_000 });
  const consult = useQuery({
    queryKey: qk.consultation(rx.data?.consultation_id ?? ''),
    queryFn: () => getConsultation(rx.data!.consultation_id!),
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
      <PrescriptionDocument organization={organization} branch={byId.get(rx.data.branch_id)} rx={rx.data} patient={patient.data} doctor={doctor.data} consultation={consult.data?.consultation} />
    </div>
  );
}
