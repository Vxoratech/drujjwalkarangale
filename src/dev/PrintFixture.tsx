/** Dev-only: the real prescription document with fictional data, for print/E2E checks. */
import { useSearchParams } from 'react-router-dom';
import { PrescriptionDocument } from '@/features/prescriptions/PrescriptionDocument';
import { fixtureClinic, fixtureConsultation, fixtureDoctor, fixturePatient, fixturePrescription } from './fixtures';

export function PrintFixture() {
  const [params] = useSearchParams();
  const lang = params.get('lang') === 'en' ? 'en' : 'mr';
  const count = Number(params.get('items') ?? 14);
  return (
    <div className="min-h-dvh bg-ivory px-4 py-6 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 max-w-[210mm] text-sm text-ink-muted" data-testid="screen-only">
        Fixture: prescription ({lang}, {count} items)
      </div>
      <PrescriptionDocument clinic={fixtureClinic} rx={fixturePrescription(lang, count)} patient={fixturePatient} doctor={fixtureDoctor} consultation={fixtureConsultation} />
    </div>
  );
}
