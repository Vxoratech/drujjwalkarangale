import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CalendarPlus, FilePlus2, Pencil, Pill, Receipt, Stethoscope } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, EmptyState, ErrorState, FullPageSpinner, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { useAccess } from '@/features/access/AccessProvider';
import { InvestigationsPanel } from '@/features/investigations/InvestigationsPanel';
import { isPermissionError, toUserMessage } from '@/lib/errors';
import { ageLabel, formatDate, formatDateTime, formatINR, fullName } from '@/lib/formatters';
import { REQUIRES } from '@/lib/permissions/permissions';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listPatientAppointments } from '@/services/appointments';
import { listInvoices } from '@/services/billing';
import { listConsultations, listFollowUps, listPrescriptions } from '@/services/clinical';
import type { AyurvedicExamination } from '@/types/domain';
import { getMedicalProfile, viewPatient } from '@/services/patients';
import { DocumentsPanel } from '@/features/documents/DocumentsPanel';
import { ConsentsPanel } from './ConsentsPanel';
import { PermissionDenied } from '@/components/feedback/States';
import { MedicalProfileCard } from './MedicalProfileCard';
import { PatientFormDrawer } from './PatientFormDrawer';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children || <span className="text-ink-muted">—</span>}</dd>
    </div>
  );
}

function VisitsTab({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const { branchName } = useAccess();
  const q = useQuery({ queryKey: qk.consultations({ patientId }), queryFn: () => listConsultations({ patientId }) });
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
                {formatDate(c.visit_date)} · {branchName(c.branch_id)}
                {c.follow_up_date && ` · ${t('consultations.followUp')}: ${formatDate(c.follow_up_date)}`}
              </p>
            </div>
            <span className="flex items-center gap-1.5">
              {(c.amendments?.length ?? 0) > 0 && <Badge tone="gold">{t('consultations.amended')}</Badge>}
              <StatusBadge status={c.status} label={c.status === 'draft' ? t('consultations.draft') : t('consultations.final')} />
            </span>
          </Link>
          <ExamSummary exam={Array.isArray(c.exam) ? c.exam[0] : c.exam} />
        </li>
      ))}
    </ul>
  );
}

/** One-line examination history under each visit (clinician-entered values only). */
function ExamSummary({ exam }: { exam: Pick<AyurvedicExamination, 'prakriti' | 'vikriti' | 'agni' | 'ama' | 'nadi'> | null | undefined }) {
  const { t } = useI18n();
  if (!exam) return null;
  const parts = [
    exam.prakriti && `${t('exam.prakriti')}: ${t(`prakriti.${exam.prakriti}`)}`,
    exam.vikriti.length > 0 && `${t('exam.vikriti')}: ${exam.vikriti.map((d) => t(`dosha.${d}`)).join(', ')}`,
    exam.agni && `${t('exam.agni')}: ${t(`agni.${exam.agni}`)}`,
    exam.ama && `${t('exam.ama')}: ${t(`ama.${exam.ama}`)}`,
    exam.nadi && `${t('exam.nadi')}: ${exam.nadi}`,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="px-4 pb-3 text-xs text-ink-muted">{parts.join(' · ')}</p>;
}

function FollowUpsTab({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const { branchName } = useAccess();
  const q = useQuery({ queryKey: ['follow-ups', { patientId }], queryFn: () => listFollowUps({ patientId }) });
  if (q.isLoading) return <SkeletonRows rows={2} />;
  if (q.isError) return <ErrorState compact onRetry={() => void q.refetch()} />;
  if (q.data!.length === 0) return <EmptyState compact icon={<CalendarClock />} title={t('followUps.none')} />;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {[...q.data!].reverse().map((f) => (
        <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="tabular font-medium">
              {t('followUps.due')} {formatDate(f.due_date)}
            </p>
            <p className="text-xs text-ink-muted">
              {branchName(f.branch_id)}
              {f.reason && ` · ${f.reason}`}
            </p>
          </div>
          <span className="flex items-center gap-2">
            <StatusBadge status={f.status === 'pending' ? 'scheduled' : f.status === 'booked' ? 'checked_in' : f.status} label={t(`followUpStatus.${f.status}`)} />
            {f.appointment_id && (
              <Link to={`/appointments/${f.appointment_id}`} className="text-sm font-medium text-forest hover:underline">
                {t('common.view')}
              </Link>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PrescriptionsTab({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.prescriptions({ patientId }), queryFn: () => listPrescriptions({ patientId }) });
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
  const params = { page: 1, pageSize: 50, patientId };
  const q = useQuery({ queryKey: qk.invoices(params), queryFn: () => listInvoices(params) });
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
  const { branchName } = useAccess();
  const q = useQuery({ queryKey: qk.appointments({ patientId }), queryFn: () => listPatientAppointments(patientId) });
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
                {t(`appointmentType.${a.type}`)} · {branchName(a.branch_id)}
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
  const { can, branchName } = useAccess();
  const [editing, setEditing] = useState(false);
  // view_patient records a 'patients.viewed' audit event server-side.
  const query = useQuery({ queryKey: ['patient-view', patientId], queryFn: () => viewPatient(patientId) });
  // Medical history needs its own permission; staff without it never receive these fields.
  const canHistory = can('patients.view_history');
  const medical = useQuery({ queryKey: ['medical-profile', patientId], queryFn: () => getMedicalProfile(patientId), enabled: canHistory });

  if (query.isLoading) return <FullPageSpinner />;
  if (query.isError) {
    if (isPermissionError(query.error) || ['PGRST116', 'P0002'].includes((query.error as { code?: string }).code ?? '')) return <PermissionDenied />;
    return <ErrorState message={toUserMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  const p = query.data!;
  const name = fullName(p);
  const age = ageLabel(p);
  const m = medical.data;
  const canVisits = can(REQUIRES.viewConsultations);
  const canPrescriptions = can(REQUIRES.viewPrescriptions);
  const canInvestigations = can(REQUIRES.viewInvestigations);
  const canDocuments = can('documents.view') || can('investigations.upload');
  const canFollowUps = can(REQUIRES.viewFollowUps);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.patients'), to: '/patients' }, { label: name }]}
        title={<PatientIdentity size="lg" name={name} code={p.patient_code} meta={[age !== '—' ? `${age} y` : null, t(`gender.${p.gender}`), p.occupation].filter(Boolean).join(' · ')} />}
        meta={
          <>
            {p.status !== 'active' && <Badge tone="warning">{t(`patientStatus.${p.status}`)}</Badge>}
            {m?.prakriti && <Badge tone="forest">{t('patients.prakriti')}: {t(`prakriti.${m.prakriti}`)}</Badge>}
            {m?.blood_group && <Badge>{m.blood_group}</Badge>}
          </>
        }
        actions={
          <>
            {can(REQUIRES.editPatient) && (
              <Button variant="secondary" leftIcon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {can('appointments.create') && (
              <Link to={`/appointments?book=1&patient=${p.id}`} className={buttonClasses('secondary')}>
                <CalendarPlus className="size-4" aria-hidden /> {t('appointments.book')}
              </Link>
            )}
            {can('billing.create') && (
              <Link to={`/billing/new?patient=${p.id}`} className={buttonClasses('secondary')}>
                <Receipt className="size-4" aria-hidden /> {t('billing.newInvoice')}
              </Link>
            )}
            {can('consultations.create') && (
              <Link to={`/consultations/new?patient=${p.id}`} className={buttonClasses('primary')}>
                <FilePlus2 className="size-4" aria-hidden /> {t('consultations.new')}
              </Link>
            )}
          </>
        }
      />

      {m?.allergies && (
        <div className="mb-4">
          <Alert tone="danger" icon={<AlertTriangle />} title={t('patients.allergies')}>
            {m.allergies}
          </Alert>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList label={name}>
          <TabsTrigger value="overview">{t('patients.overview')}</TabsTrigger>
          {canVisits && <TabsTrigger value="visits">{t('patients.visits')}</TabsTrigger>}
          {canPrescriptions && <TabsTrigger value="prescriptions">{t('patients.prescriptions')}</TabsTrigger>}
          {canInvestigations && <TabsTrigger value="investigations">{t('patients.investigations')}</TabsTrigger>}
          {canDocuments && <TabsTrigger value="documents">{t('patients.documents')}</TabsTrigger>}
          {can('appointments.view') && <TabsTrigger value="appointments">{t('patients.appointments')}</TabsTrigger>}
          {canFollowUps && <TabsTrigger value="follow-ups">{t('followUps.history')}</TabsTrigger>}
          {can('billing.view') && <TabsTrigger value="invoices">{t('patients.invoices')}</TabsTrigger>}
          {can('patients.view_basic') && <TabsTrigger value="consents">{t('patients.consents')}</TabsTrigger>}
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
            <div className="space-y-4">
              <Card>
                <CardHeader title={t('patients.registration')} />
                <CardBody>
                  <dl className="space-y-4">
                    <Detail label={t('patients.registered')}>
                      <span className="tabular">{formatDate(p.registered_on)}</span>
                    </Detail>
                    <Detail label={t('patients.registeredAt')}>{branchName(p.registered_branch_id)}</Detail>
                    <Detail label={t('patients.occupation')}>{p.occupation}</Detail>
                  </dl>
                </CardBody>
              </Card>
              {canHistory && <MedicalProfileCard patientId={p.id} profile={m ?? null} loading={medical.isLoading} />}
            </div>
          </div>
        </TabsContent>
        {canVisits && (
          <TabsContent value="visits">
            <VisitsTab patientId={p.id} />
          </TabsContent>
        )}
        {canPrescriptions && (
          <TabsContent value="prescriptions">
            <PrescriptionsTab patientId={p.id} />
          </TabsContent>
        )}
        {canInvestigations && (
          <TabsContent value="investigations">
            <InvestigationsPanel patientId={p.id} canWrite={can('investigations.order')} />
          </TabsContent>
        )}
        {canDocuments && (
          <TabsContent value="documents">
            <DocumentsPanel patientId={p.id} canWrite={can('investigations.upload')} />
          </TabsContent>
        )}
        <TabsContent value="consents">
          <ConsentsPanel patientId={p.id} />
        </TabsContent>
        {can('appointments.view') && (
          <TabsContent value="appointments">
            <AppointmentsTab patientId={p.id} />
          </TabsContent>
        )}
        {canFollowUps && (
          <TabsContent value="follow-ups">
            <FollowUpsTab patientId={p.id} />
          </TabsContent>
        )}
        {can('billing.view') && (
          <TabsContent value="invoices">
            <InvoicesTab patientId={p.id} />
          </TabsContent>
        )}
      </Tabs>

      <PatientFormDrawer open={editing} onOpenChange={setEditing} patient={p} onSaved={() => void query.refetch()} />
    </>
  );
}
