import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarPlus, FilePlus2, Pencil, Pill, Receipt, Stethoscope } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, EmptyState, ErrorState, FullPageSpinner, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { InvestigationsPanel } from '@/features/investigations/InvestigationsPanel';
import { useDoctors } from '@/hooks/useDoctors';
import { isPermissionError, toUserMessage } from '@/lib/errors';
import { ageLabel, formatDate, formatDateTime, formatINR, fullName } from '@/lib/formatters';
import { CAN_VIEW_CLINICAL } from '@/lib/permissions/permissions';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listPatientAppointments } from '@/services/appointments';
import { listInvoices } from '@/services/billing';
import { listConsultations, listPrescriptions } from '@/services/clinical';
import { viewPatient } from '@/services/patients';
import { DocumentsPanel } from '@/features/documents/DocumentsPanel';
import { ConsentsPanel } from './ConsentsPanel';
import { PermissionDenied } from '@/components/feedback/States';
import { PatientFormDrawer } from './PatientFormDrawer';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children || <span className="text-ink-subtle">—</span>}</dd>
    </div>
  );
}

function VisitsTab({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const { names } = useDoctors();
  const q = useQuery({ queryKey: qk.consultations(clinicId, { patientId }), queryFn: () => listConsultations(clinicId, { patientId }) });
  if (q.isLoading) return <SkeletonRows rows={3} />;
  if (q.isError) return <ErrorState compact onRetry={() => void q.refetch()} />;
  if (q.data!.length === 0) return <EmptyState compact icon={<Stethoscope />} title={t('consultations.emptyTitle')} body={t('consultations.emptyBody')} />;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {q.data!.map((c) => (
        <li key={c.id}>
          <Link to={`/consultations/${c.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-ivory">
            <div className="min-w-0">
              <p className="font-medium">{c.chief_complaint}</p>
              <p className="text-sm text-ink-muted">{[c.ayurvedic_diagnosis, c.diagnosis].filter(Boolean).join(' · ') || '—'}</p>
              <p className="tabular mt-0.5 text-xs text-ink-muted">
                {formatDate(c.visit_date)} · {names.get(c.doctor_id) ?? ''}
                {c.follow_up_date && ` · ${t('consultations.followUp')}: ${formatDate(c.follow_up_date)}`}
              </p>
            </div>
            <StatusBadge status={c.status} label={c.status === 'draft' ? t('consultations.draft') : t('consultations.final')} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PrescriptionsTab({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const q = useQuery({ queryKey: qk.prescriptions(clinicId, { patientId }), queryFn: () => listPrescriptions(clinicId, { patientId }) });
  if (q.isLoading) return <SkeletonRows rows={3} />;
  if (q.isError) return <ErrorState compact onRetry={() => void q.refetch()} />;
  if (q.data!.length === 0) return <EmptyState compact icon={<Pill />} title={t('prescriptions.emptyTitle')} body={t('prescriptions.emptyBody')} />;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {q.data!.map((rx) => (
        <li key={rx.id}>
          <Link to={`/prescriptions/${rx.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-ivory">
            <div className="min-w-0">
              <p className="tabular font-medium">{rx.prescription_no ?? t('prescriptionStatus.draft')}</p>
              <p className="text-sm text-ink-muted">{rx.items.map((i) => i.medicine_name).join(', ') || '—'}</p>
              <p className="tabular text-xs text-ink-muted">{formatDate(rx.issued_at ?? rx.created_at)}</p>
            </div>
            <StatusBadge status={rx.status} label={t(`prescriptionStatus.${rx.status}`)} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function InvoicesTab({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const params = { page: 1, pageSize: 50, patientId };
  const q = useQuery({ queryKey: qk.invoices(clinicId, params), queryFn: () => listInvoices(clinicId, params) });
  if (q.isLoading) return <SkeletonRows rows={3} />;
  if (q.isError) return <ErrorState compact onRetry={() => void q.refetch()} />;
  if (q.data!.rows.length === 0) return <EmptyState compact icon={<Receipt />} title={t('billing.emptyTitle')} />;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {q.data!.rows.map((inv) => (
        <li key={inv.id}>
          <Link to={`/billing/${inv.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-ivory">
            <div>
              <p className="tabular font-medium">{inv.invoice_no}</p>
              <p className="tabular text-xs text-ink-muted">{formatDate(inv.issue_date)}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular font-medium">{formatINR(inv.total_paise)}</span>
              <StatusBadge status={inv.status} label={t(`invoiceStatus.${inv.status}`)} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AppointmentsTab({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const { names } = useDoctors();
  const q = useQuery({ queryKey: qk.appointments(clinicId, { patientId }), queryFn: () => listPatientAppointments(clinicId, patientId) });
  if (q.isLoading) return <SkeletonRows rows={3} />;
  if (q.isError) return <ErrorState compact onRetry={() => void q.refetch()} />;
  if (q.data!.length === 0) return <EmptyState compact title={t('appointments.emptyDay')} />;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {q.data!.map((a) => (
        <li key={a.id}>
          <Link to={`/appointments/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-ivory">
            <div>
              <p className="tabular font-medium">{formatDateTime(a.starts_at)}</p>
              <p className="text-xs text-ink-muted">
                {t(`appointmentType.${a.type}`)} · {names.get(a.doctor_id) ?? ''}
              </p>
            </div>
            <StatusBadge status={a.status} label={t(`appointmentStatus.${a.status}`)} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PatientDetailPage() {
  const { patientId = '' } = useParams();
  const { t } = useI18n();
  const { clinicId, can } = useClinic();
  const { names } = useDoctors();
  const [editing, setEditing] = useState(false);
  // view_patient records a 'patients.viewed' audit event server-side.
  const query = useQuery({ queryKey: [clinicId, 'patient-view', patientId], queryFn: () => viewPatient(patientId) });

  if (query.isLoading) return <FullPageSpinner />;
  if (query.isError) {
    if (isPermissionError(query.error) || ['PGRST116', 'P0002'].includes((query.error as { code?: string }).code ?? '')) return <PermissionDenied />;
    return <ErrorState message={toUserMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  const p = query.data!;
  const name = fullName(p);
  const age = ageLabel(p);
  const canClinical = can(CAN_VIEW_CLINICAL);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.patients'), to: '/patients' }, { label: name }]}
        title={<PatientIdentity size="lg" name={name} code={p.patient_code} meta={[age !== '—' ? `${age} y` : null, t(`gender.${p.gender}`), p.occupation].filter(Boolean).join(' · ')} />}
        meta={
          <>
            {p.status !== 'active' && <Badge tone="warning">{t(`patientStatus.${p.status}`)}</Badge>}
            {p.prakriti && <Badge tone="forest">{t('patients.prakriti')}: {t(`prakriti.${p.prakriti}`)}</Badge>}
            {p.blood_group && <Badge>{p.blood_group}</Badge>}
            {p.assigned_doctor_id && <Badge tone="gold">{names.get(p.assigned_doctor_id) ?? t('patients.assignedDoctor')}</Badge>}
          </>
        }
        actions={
          <>
            {can('patients.update') && (
              <Button variant="secondary" leftIcon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {can('appointments.manage') && (
              <Link to={`/appointments?book=1&patient=${p.id}`} className={buttonClasses('secondary')}>
                <CalendarPlus className="size-4" aria-hidden /> {t('appointments.book')}
              </Link>
            )}
            {can('billing.create') && (
              <Link to={`/billing/new?patient=${p.id}`} className={buttonClasses('secondary')}>
                <Receipt className="size-4" aria-hidden /> {t('billing.newInvoice')}
              </Link>
            )}
            {can('clinical.write') && (
              <Link to={`/consultations/new?patient=${p.id}`} className={buttonClasses('primary')}>
                <FilePlus2 className="size-4" aria-hidden /> {t('consultations.new')}
              </Link>
            )}
          </>
        }
      />

      {p.allergies && (
        <div className="mb-4">
          <Alert tone="danger" icon={<AlertTriangle />} title={t('patients.allergies')}>
            {p.allergies}
          </Alert>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList label={name}>
          <TabsTrigger value="overview">{t('patients.overview')}</TabsTrigger>
          {canClinical && <TabsTrigger value="visits">{t('patients.visits')}</TabsTrigger>}
          {canClinical && <TabsTrigger value="prescriptions">{t('patients.prescriptions')}</TabsTrigger>}
          {canClinical && <TabsTrigger value="investigations">{t('patients.investigations')}</TabsTrigger>}
          {canClinical && <TabsTrigger value="documents">{t('patients.documents')}</TabsTrigger>}
          <TabsTrigger value="appointments">{t('patients.appointments')}</TabsTrigger>
          {can('billing.read') && <TabsTrigger value="invoices">{t('patients.invoices')}</TabsTrigger>}
          <TabsTrigger value="consents">{t('patients.consents')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title={t('patients.sectionContact')} />
              <CardBody>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Detail label={t('patients.phone')}>{p.phone && <span className="tabular">{p.phone}</span>}</Detail>
                  <Detail label={t('patients.email')}>{p.email}</Detail>
                  <Detail label={t('patients.address')}>{[p.address_line, p.city].filter(Boolean).join(', ')}</Detail>
                  <Detail label={t('patients.dob')}>{p.date_of_birth && <span className="tabular">{formatDate(p.date_of_birth)}</span>}</Detail>
                  <Detail label={t('patients.emergencyContact')}>{[p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(' · ')}</Detail>
                  <Detail label={t('patients.preferredLanguage')}>{p.preferred_locale === 'mr' ? 'मराठी' : 'English'}</Detail>
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('patients.sectionMedical')} />
              <CardBody>
                <dl className="space-y-4">
                  <Detail label={t('patients.prakriti')}>{p.prakriti && t(`prakriti.${p.prakriti}`)}</Detail>
                  <Detail label={t('patients.chronicConditions')}>{p.chronic_conditions && <span className="whitespace-pre-line">{p.chronic_conditions}</span>}</Detail>
                  <Detail label={t('patients.allergies')}>{p.allergies}</Detail>
                  <Detail label={t('patients.occupation')}>{p.occupation}</Detail>
                  <Detail label={t('patients.registered')}>
                    <span className="tabular">{formatDate(p.registered_on)}</span>
                  </Detail>
                </dl>
              </CardBody>
            </Card>
          </div>
        </TabsContent>
        {canClinical && (
          <TabsContent value="visits">
            <VisitsTab patientId={p.id} />
          </TabsContent>
        )}
        {canClinical && (
          <TabsContent value="prescriptions">
            <PrescriptionsTab patientId={p.id} />
          </TabsContent>
        )}
        {canClinical && (
          <TabsContent value="investigations">
            <InvestigationsPanel patientId={p.id} canWrite={can('clinical.write')} />
          </TabsContent>
        )}
        {canClinical && (
          <TabsContent value="documents">
            <DocumentsPanel patientId={p.id} canWrite={can('clinical.write')} />
          </TabsContent>
        )}
        <TabsContent value="consents">
          <ConsentsPanel patientId={p.id} />
        </TabsContent>
        <TabsContent value="appointments">
          <AppointmentsTab patientId={p.id} />
        </TabsContent>
        {can('billing.read') && (
          <TabsContent value="invoices">
            <InvoicesTab patientId={p.id} />
          </TabsContent>
        )}
      </Tabs>

      <PatientFormDrawer open={editing} onOpenChange={setEditing} patient={p} onSaved={() => void query.refetch()} />
    </>
  );
}
