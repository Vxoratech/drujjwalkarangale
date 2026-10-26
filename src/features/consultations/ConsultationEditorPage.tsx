import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Info, Lock, Pill, Plus, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, ErrorState, FullPageSpinner, PermissionDenied } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid, FormSection } from '@/components/forms/FormField';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Checkbox, DateInput, Input, RadioGroup, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { InvestigationsPanel } from '@/features/investigations/InvestigationsPanel';
import { useDoctors } from '@/hooks/useDoctors';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { cn } from '@/lib/cn';
import { isPermissionError, toUserMessage } from '@/lib/errors';
import { ageLabel, formatDate, formatDateTime, fullName, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n, type TranslationKey } from '@/locales/i18n';
import { getAppointment } from '@/services/appointments';
import { addAmendment, finalizeConsultation, getConsultation, listAmendments, listConsultations, listExamFields, listPrescriptions, saveConsultation } from '@/services/clinical';
import { getPatient } from '@/services/patients';
import { AGNIS, AMA_LEVELS, BALAS, DOSHAS, KOSHTHAS, PRAKRITIS, type ConsultationSection } from '@/types/domain';
import { computeBmi, consultationSchema, offersMenstrualHistory, toConsultationForm, toConsultationPayload, type ConsultationFormInput, type ConsultationFormValues } from './consultationSchema';

const ASHTAVIDHA = ['nadi', 'mutra', 'mala', 'jihva', 'shabda', 'sparsha', 'drik', 'akriti'] as const;
const LIFESTYLE = [
  ['nidra', 'exam.nidra'],
  ['appetite', 'exam.appetite'],
  ['digestion', 'exam.digestion'],
  ['bowel_habits', 'exam.bowelHabits'],
] as const;
const NARRATIVE = [
  ['dinacharya', 'exam.dinacharya'],
  ['lifestyle', 'exam.lifestyle'],
] as const;

function RxPanel({ consultationId, patientId, canWrite }: { consultationId: string; patientId: string; canWrite: boolean }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const q = useQuery({ queryKey: qk.prescriptions(clinicId, { consultationId }), queryFn: () => listPrescriptions(clinicId, { consultationId }) });
  return (
    <Card>
      <CardHeader
        title={t('prescriptions.title')}
        actions={
          canWrite && (
            <Link to={`/prescriptions/new?consultation=${consultationId}&patient=${patientId}`} className={buttonClasses('secondary', 'sm')}>
              <Plus className="size-4" aria-hidden /> {t('prescriptions.new')}
            </Link>
          )
        }
      />
      <CardBody>
        {q.isLoading ? (
          <p className="text-sm text-ink-muted">{t('common.loading')}</p>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{t('prescriptions.emptyBody')}</p>
        ) : (
          <ul className="space-y-2">
            {q.data!.map((rx) => (
              <li key={rx.id}>
                <Link to={`/prescriptions/${rx.id}`} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 hover:bg-ivory">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <Pill className="size-4 shrink-0 text-forest" aria-hidden />
                    <span className="truncate">{rx.items.map((i) => i.medicine_name).join(', ') || '—'}</span>
                  </span>
                  <StatusBadge status={rx.status} label={t(`prescriptionStatus.${rx.status}`)} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Earlier visits of the same patient, for review before and during a consultation. */
function PreviousVisits({ patientId, excludeId }: { patientId: string; excludeId?: string }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const { names } = useDoctors();
  const q = useQuery({ queryKey: qk.consultations(clinicId, { patientId }), queryFn: () => listConsultations(clinicId, { patientId }) });
  const rows = (q.data ?? []).filter((v) => v.id !== excludeId).slice(0, 5);
  return (
    <Card>
      <CardHeader title={t('history.previousVisits')} />
      <CardBody>
        {q.isLoading ? (
          <p className="text-sm text-ink-muted">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('history.noPreviousVisits')}</p>
        ) : (
          <ol className="space-y-3">
            {rows.map((v) => (
              <li key={v.id}>
                <details className="group rounded-md border border-line px-3 py-2">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="tabular block text-xs text-ink-muted">
                        {formatDate(v.visit_date)} · {names.get(v.doctor_id) ?? ''}
                      </span>
                      <span className="line-clamp-1 font-medium">{v.chief_complaint}</span>
                    </span>
                    <StatusBadge status={v.status} label={v.status === 'draft' ? t('consultations.draft') : t('consultations.final')} />
                  </summary>
                  <div className="mt-2 space-y-1 text-xs text-ink-muted">
                    {[v.ayurvedic_diagnosis, v.diagnosis].filter(Boolean).length > 0 && <p>{[v.ayurvedic_diagnosis, v.diagnosis].filter(Boolean).join(' · ')}</p>}
                    <Link to={`/consultations/${v.id}`} className="font-medium text-forest hover:underline">
                      {t('common.view')}
                    </Link>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

/** Append-only addenda for finalized consultations. */
function AmendmentsPanel({ consultationId, canAmend }: { consultationId: string; canAmend: boolean }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const { names } = useDoctors();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [content, setContent] = useState('');
  const q = useQuery({ queryKey: [clinicId, 'amendments', consultationId, 'list'], queryFn: () => listAmendments(consultationId) });
  const add = useMutation({
    mutationFn: () => addAmendment(clinicId, { consultationId, reason: reason.trim(), content: content.trim() }),
    onSuccess: async () => {
      notify.success(t('history.amendmentAdded'));
      setOpen(false);
      setReason('');
      setContent('');
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'amendments', consultationId] });
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'consultations'] });
    },
    onError: (e) => notify.error(e),
  });
  return (
    <Card>
      <CardHeader
        title={t('history.amendments')}
        actions={
          canAmend && (
            <Button size="sm" variant="secondary" leftIcon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
              {t('history.addAmendment')}
            </Button>
          )
        }
      />
      <CardBody>
        {(q.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{t('history.noAmendments')}</p>
        ) : (
          <ol className="space-y-3">
            {q.data!.map((a) => (
              <li key={a.id} className="border-l-2 border-gold pl-3 text-sm">
                <p className="tabular text-xs text-ink-muted">
                  {formatDateTime(a.created_at)} · {names.get(a.author_id) ?? ''}
                </p>
                <p className="font-medium">{a.reason}</p>
                <p className="whitespace-pre-line">{a.content}</p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('history.addAmendment')}
        body={t('history.amendmentHint')}
        confirmLabel={t('common.save')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={!reason.trim() || !content.trim()}
        onConfirm={() => add.mutateAsync()}
      >
        <FormField label={t('history.amendmentReason')} required>
          <Input maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </FormField>
        <FormField label={t('history.amendmentContent')} required>
          <Textarea rows={4} maxLength={5000} value={content} onChange={(ev) => setContent(ev.target.value)} />
        </FormField>
      </ConfirmDialog>
    </Card>
  );
}

export function ConsultationEditorPage() {
  const { consultationId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { t, tb, locale } = useI18n();
  const user = useCurrentUser();
  const { clinicId, can } = useClinic();
  const { names } = useDoctors();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const { clinic } = useClinic();
  const show = (section: ConsultationSection) => clinic.settings.consultation_sections?.[section] !== false;
  const examFields = useQuery({ queryKey: [clinicId, 'exam-fields'], queryFn: () => listExamFields(clinicId), staleTime: 5 * 60_000 });

  const bundle = useQuery({ queryKey: qk.consultation(clinicId, consultationId ?? ''), queryFn: () => getConsultation(clinicId, consultationId!), enabled: Boolean(consultationId) });
  const appointmentId = consultationId ? bundle.data?.consultation.appointment_id ?? null : search.get('appointment');
  const patientId = consultationId ? bundle.data?.consultation.patient_id : search.get('patient');
  const patient = useQuery({ queryKey: qk.patient(clinicId, patientId ?? ''), queryFn: () => getPatient(clinicId, patientId!), enabled: Boolean(patientId) });
  const appointment = useQuery({ queryKey: qk.appointment(clinicId, appointmentId ?? ''), queryFn: () => getAppointment(clinicId, appointmentId!), enabled: Boolean(appointmentId) && !consultationId });

  const c = bundle.data?.consultation;
  const amendmentCount = useQuery({
    queryKey: [clinicId, 'amendments', consultationId],
    queryFn: async () => (await listAmendments(consultationId!)).length,
    enabled: Boolean(consultationId) && c?.status === 'finalized',
  });
  const readOnly = Boolean(c && (c.status === 'finalized' || c.doctor_id !== user.id)) || !can('clinical.write');

  const form = useForm<ConsultationFormInput, unknown, ConsultationFormValues>({ resolver: zodResolver(consultationSchema), defaultValues: toConsultationForm() });
  const { register, control, formState, reset } = form;
  const e = formState.errors;

  useEffect(() => {
    if (consultationId && bundle.data) reset(toConsultationForm(bundle.data.consultation, bundle.data.examination));
    else if (!consultationId && patient.data) reset({ ...toConsultationForm(null, null, patient.data.prakriti), chief_complaint: appointment.data?.reason ?? '' });
  }, [consultationId, bundle.data, patient.data, appointment.data, reset]);

  useUnsavedChangesGuard(formState.isDirty && !readOnly && !formState.isSubmitting, t('consultations.unsaved'));

  const [weight, height] = useWatch({ control, name: ['weight_kg', 'height_cm'] });
  const bmi = useMemo(() => computeBmi(Number(weight) || null, Number(height) || null), [weight, height]);

  const save = useMutation({
    mutationFn: async ({ values, finalize }: { values: ConsultationFormValues; finalize: boolean }) => {
      const payload = toConsultationPayload(values, { patient_id: patientId!, doctor_id: user.id, appointment_id: appointmentId ?? null });
      const id = await saveConsultation(clinicId, payload.input, payload.exam, consultationId);
      if (finalize) await finalizeConsultation(id);
      return { id, finalize };
    },
    onSuccess: async ({ id, finalize }) => {
      notify.success(finalize ? t('consultations.finalized') : t('consultations.saved'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [clinicId, 'consultation', id] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'consultations'] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'appointments'] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'dashboard'] }),
      ]);
      reset(form.getValues());
      if (!consultationId) navigate(`/consultations/${id}`, { replace: true });
    },
    onError: (err) => notify.error(err),
  });

  if ((consultationId && bundle.isLoading) || (patientId && patient.isLoading)) return <FullPageSpinner />;
  const loadError = bundle.error ?? patient.error;
  if (loadError) {
    if (isPermissionError(loadError) || (loadError as { code?: string }).code === 'PGRST116') return <PermissionDenied />;
    return <ErrorState message={toUserMessage(loadError)} onRetry={() => void (bundle.refetch(), patient.refetch())} />;
  }
  if (!patientId || !patient.data) return <ErrorState message={t('states.notFoundBody')} />;

  const p = patient.data;
  const age = ageLabel(p);
  const submit = (finalize: boolean) => form.handleSubmit((values) => save.mutateAsync({ values, finalize }));
  const choice = <T extends string>(values: readonly T[], prefix: string) => values.map((v) => ({ value: v, label: t(`${prefix}.${v}` as TranslationKey) }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.patients'), to: '/patients' }, { label: fullName(p), to: `/patients/${p.id}` }, { label: consultationId ? formatDate(c?.visit_date) : t('consultations.new') }]}
        title={consultationId ? t('consultations.title') : t('consultations.new')}
        meta={
          <>
            <PatientIdentity name={fullName(p)} code={p.patient_code} meta={[age !== '—' ? `${age} y` : null, t(`gender.${p.gender}`), p.occupation].filter(Boolean).join(' · ')} />
            {c && <StatusBadge status={c.status} label={c.status === 'draft' ? t('consultations.draft') : t('consultations.final')} />}
            {c && (amendmentCount.data ?? 0) > 0 && <Badge tone="gold">{t('consultations.amended')}</Badge>}
            {c && c.doctor_id !== user.id && <Badge tone="gold">{names.get(c.doctor_id)}</Badge>}
          </>
        }
        actions={
          !readOnly && (
            <>
              <Button variant="secondary" leftIcon={<Save className="size-4" />} loading={save.isPending && !confirmFinalize} onClick={() => void submit(false)()}>
                {t('common.saveDraft')}
              </Button>
              <Button leftIcon={<CheckCircle2 className="size-4" />} onClick={() => void form.trigger().then((ok) => ok && setConfirmFinalize(true))}>
                {t('consultations.finalize')}
              </Button>
            </>
          )
        }
      />

      {p.allergies && (
        <div className="mb-4">
          <Alert tone="danger" title={t('patients.allergies')}>
            {p.allergies}
          </Alert>
        </div>
      )}
      {readOnly && c && (
        <div className="mb-4">
          <Alert tone="info" icon={<Lock />}>
            {t('consultations.locked')}
          </Alert>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form noValidate onSubmit={(ev) => ev.preventDefault()}>
          <fieldset disabled={readOnly || save.isPending} className="space-y-6">
            <Card>
              <CardBody className="space-y-6 py-6">
                <FormSection title={tb('consultations.sectionHistory')}>
                  <FormField label={tb('consultations.chiefComplaint')} error={fieldError(e.chief_complaint)} required>
                    <Textarea rows={2} {...register('chief_complaint')} />
                  </FormField>
                  {show('pain') && (
                    <FormField label={tb('history.vedanaVishesha')} hint={t('history.vedanaHint')} error={fieldError(e.pain_details)}>
                      <Textarea rows={2} {...register('pain_details')} />
                    </FormField>
                  )}
                  <FormGrid>
                    <FormField label={tb('consultations.hpi')} error={fieldError(e.history_of_present_illness)}>
                      <Textarea rows={3} {...register('history_of_present_illness')} />
                    </FormField>
                    <FormField label={tb('consultations.pastHistory')} error={fieldError(e.past_history)}>
                      <Textarea rows={3} {...register('past_history')} />
                    </FormField>
                  </FormGrid>
                </FormSection>

                {show('family_history') && (
                  <FormSection title={tb('history.familyHistory')}>
                    <FormGrid cols={3}>
                      <FormField label={tb('history.maternal')} error={fieldError(e.exam?.family_history_maternal)}>
                        <Textarea rows={2} {...register('exam.family_history_maternal')} />
                      </FormField>
                      <FormField label={tb('history.paternal')} error={fieldError(e.exam?.family_history_paternal)}>
                        <Textarea rows={2} {...register('exam.family_history_paternal')} />
                      </FormField>
                      <FormField label={tb('history.self')} error={fieldError(e.exam?.family_history_self)}>
                        <Textarea rows={2} {...register('exam.family_history_self')} />
                      </FormField>
                    </FormGrid>
                    <FormField label={tb('history.familyOther')} error={fieldError(e.exam?.family_history)}>
                      <Input {...register('exam.family_history')} />
                    </FormField>
                  </FormSection>
                )}

                {show('menstrual_history') && offersMenstrualHistory(p.gender) && (
                  <FormSection title={tb('history.rajoItihas')} description={t('history.rajoHint')}>
                    <FormField label={tb('history.rajoItihas')} hideLabel error={fieldError(e.exam?.menstrual_history)}>
                      <Textarea rows={2} {...register('exam.menstrual_history')} />
                    </FormField>
                  </FormSection>
                )}

                <FormSection title={t('consultations.vitals')}>
                  <FormGrid cols={4}>
                    <FormField label={tb('consultations.pulse')} error={fieldError(e.pulse_bpm)}>
                      <Input inputMode="numeric" className="tabular" {...register('pulse_bpm')} />
                    </FormField>
                    <FormField label={`${t('consultations.bp')} — ${t('consultations.systolic')}`} error={fieldError(e.bp_systolic)}>
                      <Input inputMode="numeric" className="tabular" {...register('bp_systolic')} />
                    </FormField>
                    <FormField label={`${t('consultations.bp')} — ${t('consultations.diastolic')}`} error={fieldError(e.bp_diastolic)}>
                      <Input inputMode="numeric" className="tabular" {...register('bp_diastolic')} />
                    </FormField>
                    <FormField label={tb('consultations.temperature')} error={fieldError(e.temperature_c)}>
                      <Input inputMode="decimal" className="tabular" {...register('temperature_c')} />
                    </FormField>
                    <FormField label={tb('consultations.weight')} error={fieldError(e.weight_kg)}>
                      <Input inputMode="decimal" className="tabular" {...register('weight_kg')} />
                    </FormField>
                    <FormField label={tb('consultations.height')} error={fieldError(e.height_cm)}>
                      <Input inputMode="decimal" className="tabular" {...register('height_cm')} />
                    </FormField>
                    <FormField label={tb('consultations.spo2')} error={fieldError(e.spo2_percent)}>
                      <Input inputMode="numeric" className="tabular" {...register('spo2_percent')} />
                    </FormField>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-ink">{t('consultations.bmi')}</span>
                      <output className="tabular flex h-10 items-center rounded-md bg-ivory px-3 text-sm" aria-live="polite">
                        {bmi ?? '—'}
                      </output>
                    </div>
                  </FormGrid>
                </FormSection>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={tb('exam.title')} />
              <CardBody className="space-y-6 py-6">
                <p className="flex items-start gap-2 rounded-md bg-ivory px-3 py-2 text-xs text-ink-muted">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t('exam.disclaimer')}
                </p>
                <FormGrid>
                  <FormField label={tb('exam.prakriti')}>
                    <Select placeholder="—" options={choice(PRAKRITIS, 'prakriti')} {...register('exam.prakriti')} />
                  </FormField>
                  <Controller
                    control={control}
                    name="exam.vikriti"
                    render={({ field }) => (
                      <fieldset>
                        <legend className="mb-1.5 text-sm font-medium">{t('exam.vikriti')}</legend>
                        <div className="flex flex-wrap gap-2">
                          {DOSHAS.map((d) => {
                            const checked = field.value.includes(d);
                            return (
                              <label key={d} className={cn('inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:shadow-focus', checked ? 'border-forest bg-sage text-forest-deep' : 'border-line-strong bg-surface hover:bg-ivory')}>
                                <input
                                  type="checkbox"
                                  className="size-4 accent-[var(--color-forest)]"
                                  checked={checked}
                                  onChange={() => field.onChange(checked ? field.value.filter((x) => x !== d) : [...field.value, d])}
                                />
                                {t(`dosha.${d}`)}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    )}
                  />
                </FormGrid>
                {show('dosha_assessment') && (
                <FormSection title={tb('exam.doshaAssessment')}>
                  <FormGrid cols={3}>
                    {(
                      [
                        ['vata_score', 'exam.vataScore'],
                        ['pitta_score', 'exam.pittaScore'],
                        ['kapha_score', 'exam.kaphaScore'],
                      ] as const
                    ).map(([name, label]) => (
                      <FormField key={name} label={tb(label)} error={fieldError(e.exam?.[name])}>
                        <Input type="number" min={0} max={10} step={1} inputMode="numeric" className="tabular" {...register(`exam.${name}`)} />
                      </FormField>
                    ))}
                  </FormGrid>
                </FormSection>
                )}
                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                  {(
                    [
                      ['agni', AGNIS],
                      ['ama', AMA_LEVELS],
                      ['koshtha', KOSHTHAS],
                      ['bala', BALAS],
                    ] as const
                  ).map(([name, values]) => (
                    <Controller
                      key={name}
                      control={control}
                      name={`exam.${name}`}
                      render={({ field }) => (
                        <RadioGroup name={name} legend={tb(`exam.${name}`)} value={field.value || null} onChange={field.onChange} options={choice(values, name)} disabled={readOnly} />
                      )}
                    />
                  ))}
                </div>
                <FormSection title={tb('exam.ashtavidha')}>
                  <FormGrid cols={4}>
                    {ASHTAVIDHA.map((k) => (
                      <FormField key={k} label={tb(`exam.${k}`)} error={fieldError(e.exam?.[k])}>
                        <Input {...register(`exam.${k}`)} />
                      </FormField>
                    ))}
                  </FormGrid>
                  <FormGrid>
                    <FormField label={tb('exam.sara')}>
                      <Input {...register('exam.sara')} />
                    </FormField>
                    <FormField label={tb('exam.satva')}>
                      <Input {...register('exam.satva')} />
                    </FormField>
                  </FormGrid>
                </FormSection>
                {show('general_examination') && (
                  <FormField label={tb('exam.generalExamination')} error={fieldError(e.exam?.general_examination)}>
                    <Textarea rows={2} {...register('exam.general_examination')} />
                  </FormField>
                )}
                {show('dinacharya') && (
                <FormSection title={tb('exam.lifestyleSection')}>
                  <FormGrid cols={4}>
                    {LIFESTYLE.map(([name, label]) => (
                      <FormField key={name} label={tb(label)} error={fieldError(e.exam?.[name])}>
                        <Input {...register(`exam.${name}`)} />
                      </FormField>
                    ))}
                  </FormGrid>
                  <FormGrid>
                    {NARRATIVE.map(([name, label]) => (
                      <FormField key={name} label={tb(label)} error={fieldError(e.exam?.[name])}>
                        <Textarea rows={2} {...register(`exam.${name}`)} />
                      </FormField>
                    ))}
                  </FormGrid>
                </FormSection>
                )}
                {show('clinic_fields') && (examFields.data ?? []).length > 0 && (
                  <FormSection title={tb('exam.clinicFields')}>
                    <FormGrid cols={3}>
                      {examFields.data!.map((f) => {
                        const label = `${(locale === 'mr' && f.label_mr) || f.label_en}${f.unit ? ` (${f.unit})` : ''}`;
                        const name = `exam.custom_fields.${f.key}` as const;
                        if (f.field_type === 'boolean') return <Checkbox key={f.id} label={label} {...register(name)} />;
                        return (
                          <FormField key={f.id} label={label}>
                            {f.field_type === 'select' ? (
                              <Select placeholder="—" options={(f.options ?? []).map((o) => ({ value: o, label: o }))} {...register(name, { setValueAs: (v: string) => v || null })} />
                            ) : (
                              <Input
                                inputMode={f.field_type === 'number' ? 'decimal' : undefined}
                                className={f.field_type === 'number' ? 'tabular' : undefined}
                                {...register(name, { setValueAs: (v: string) => (v === '' ? null : f.field_type === 'number' ? Number(v) : v) })}
                              />
                            )}
                          </FormField>
                        );
                      })}
                    </FormGrid>
                  </FormSection>
                )}
                <FormField label={tb('exam.notes')} error={fieldError(e.exam?.notes)}>
                  <Textarea rows={2} {...register('exam.notes')} />
                </FormField>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-6 py-6">
                <FormSection title={tb('consultations.sectionAssessment')}>
                  <FormGrid>
                    <FormField label={tb('consultations.findings')} error={fieldError(e.clinical_findings)}>
                      <Textarea rows={2} {...register('clinical_findings')} />
                    </FormField>
                    <FormField label={tb('consultations.assessment')} error={fieldError(e.assessment)}>
                      <Textarea rows={2} {...register('assessment')} />
                    </FormField>
                  </FormGrid>
                  <FormGrid>
                    <FormField label={tb('consultations.ayurvedicDiagnosis')} error={fieldError(e.ayurvedic_diagnosis)}>
                      <Input {...register('ayurvedic_diagnosis')} />
                    </FormField>
                    <FormField label={tb('consultations.diagnosis')} error={fieldError(e.diagnosis)}>
                      <Input {...register('diagnosis')} />
                    </FormField>
                  </FormGrid>
                  <FormField label={tb('consultations.plan')} error={fieldError(e.treatment_plan)}>
                    <Textarea rows={3} {...register('treatment_plan')} />
                  </FormField>
                  <FormGrid>
                    <FormField label={tb('consultations.pathya')} error={fieldError(e.pathya)}>
                      <Textarea rows={3} {...register('pathya')} />
                    </FormField>
                    <FormField label={tb('consultations.apathya')} error={fieldError(e.apathya)}>
                      <Textarea rows={3} {...register('apathya')} />
                    </FormField>
                  </FormGrid>
                  <div className="max-w-xs">
                    <FormField label={tb('consultations.followUp')} error={fieldError(e.follow_up_date)}>
                      <DateInput min={c?.visit_date ?? todayISO()} {...register('follow_up_date')} />
                    </FormField>
                  </div>
                </FormSection>
                <FormSection title={tb('history.doctorNotes')} description={t('history.doctorNotesHint')}>
                  <FormField label={tb('history.doctorNotes')} hideLabel error={fieldError(e.doctor_notes)}>
                    <Textarea rows={3} {...register('doctor_notes')} />
                  </FormField>
                </FormSection>
                <p className="text-xs text-ink-muted">{t('history.requiredNote')}</p>
              </CardBody>
            </Card>
          </fieldset>
        </form>

        <aside className="space-y-4">
          {c?.status === 'finalized' && <AmendmentsPanel consultationId={c.id} canAmend={c.doctor_id === user.id && can('clinical.write')} />}
          <PreviousVisits patientId={p.id} excludeId={consultationId} />
          {consultationId ? (
            <>
              <RxPanel consultationId={consultationId} patientId={p.id} canWrite={!readOnly || (c?.doctor_id === user.id && can('clinical.write'))} />
              <Card>
                <CardHeader title={t('investigations.title')} />
                <CardBody>
                  <InvestigationsPanel patientId={p.id} consultationId={consultationId} canWrite={can('clinical.write')} />
                </CardBody>
              </Card>
            </>
          ) : (
            <Alert tone="info">{t('prescriptions.emptyBody')}</Alert>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmFinalize}
        onOpenChange={setConfirmFinalize}
        title={t('consultations.finalizeConfirmTitle')}
        body={t('consultations.finalizeConfirmBody')}
        confirmLabel={t('consultations.finalize')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => submit(true)()}
      />
    </>
  );
}
