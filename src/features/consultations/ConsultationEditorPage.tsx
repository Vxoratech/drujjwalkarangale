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
import { ageFromDob, formatDate, fullName, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n, type TranslationKey } from '@/locales/i18n';
import { getAppointment } from '@/services/appointments';
import { finalizeConsultation, getConsultation, listExamFields, listPrescriptions, saveConsultation } from '@/services/clinical';
import { getPatient } from '@/services/patients';
import { AGNIS, AMA_LEVELS, BALAS, DOSHAS, KOSHTHAS, PRAKRITIS } from '@/types/domain';
import { computeBmi, consultationSchema, toConsultationForm, toConsultationPayload, type ConsultationFormInput, type ConsultationFormValues } from './consultationSchema';

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
  ['general_examination', 'exam.generalExamination'],
  ['family_history', 'exam.familyHistory'],
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

export function ConsultationEditorPage() {
  const { consultationId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const user = useCurrentUser();
  const { clinicId, can } = useClinic();
  const { names } = useDoctors();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const examFields = useQuery({ queryKey: [clinicId, 'exam-fields'], queryFn: () => listExamFields(clinicId), staleTime: 5 * 60_000 });

  const bundle = useQuery({ queryKey: qk.consultation(clinicId, consultationId ?? ''), queryFn: () => getConsultation(clinicId, consultationId!), enabled: Boolean(consultationId) });
  const appointmentId = consultationId ? bundle.data?.consultation.appointment_id ?? null : search.get('appointment');
  const patientId = consultationId ? bundle.data?.consultation.patient_id : search.get('patient');
  const patient = useQuery({ queryKey: qk.patient(clinicId, patientId ?? ''), queryFn: () => getPatient(clinicId, patientId!), enabled: Boolean(patientId) });
  const appointment = useQuery({ queryKey: qk.appointment(clinicId, appointmentId ?? ''), queryFn: () => getAppointment(clinicId, appointmentId!), enabled: Boolean(appointmentId) && !consultationId });

  const c = bundle.data?.consultation;
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
  const age = ageFromDob(p.date_of_birth);
  const submit = (finalize: boolean) => form.handleSubmit((values) => save.mutateAsync({ values, finalize }));
  const choice = <T extends string>(values: readonly T[], prefix: string) => values.map((v) => ({ value: v, label: t(`${prefix}.${v}` as TranslationKey) }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.patients'), to: '/patients' }, { label: fullName(p), to: `/patients/${p.id}` }, { label: consultationId ? formatDate(c?.visit_date) : t('consultations.new') }]}
        title={consultationId ? t('consultations.title') : t('consultations.new')}
        meta={
          <>
            <PatientIdentity name={fullName(p)} code={p.patient_code} meta={[age !== null ? `${age} y` : null, t(`gender.${p.gender}`)].filter(Boolean).join(' · ')} />
            {c && <StatusBadge status={c.status} label={c.status === 'draft' ? t('consultations.draft') : t('consultations.final')} />}
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
                <FormSection title={t('consultations.sectionHistory')}>
                  <FormField label={t('consultations.chiefComplaint')} error={fieldError(e.chief_complaint)} required>
                    <Textarea rows={2} {...register('chief_complaint')} />
                  </FormField>
                  <FormGrid>
                    <FormField label={t('consultations.hpi')} error={fieldError(e.history_of_present_illness)}>
                      <Textarea rows={3} {...register('history_of_present_illness')} />
                    </FormField>
                    <FormField label={t('consultations.pastHistory')} error={fieldError(e.past_history)}>
                      <Textarea rows={3} {...register('past_history')} />
                    </FormField>
                  </FormGrid>
                </FormSection>

                <FormSection title={t('consultations.vitals')}>
                  <FormGrid cols={4}>
                    <FormField label={t('consultations.pulse')} error={fieldError(e.pulse_bpm)}>
                      <Input inputMode="numeric" className="tabular" {...register('pulse_bpm')} />
                    </FormField>
                    <FormField label={`${t('consultations.bp')} — ${t('consultations.systolic')}`} error={fieldError(e.bp_systolic)}>
                      <Input inputMode="numeric" className="tabular" {...register('bp_systolic')} />
                    </FormField>
                    <FormField label={`${t('consultations.bp')} — ${t('consultations.diastolic')}`} error={fieldError(e.bp_diastolic)}>
                      <Input inputMode="numeric" className="tabular" {...register('bp_diastolic')} />
                    </FormField>
                    <FormField label={t('consultations.temperature')} error={fieldError(e.temperature_c)}>
                      <Input inputMode="decimal" className="tabular" {...register('temperature_c')} />
                    </FormField>
                    <FormField label={t('consultations.weight')} error={fieldError(e.weight_kg)}>
                      <Input inputMode="decimal" className="tabular" {...register('weight_kg')} />
                    </FormField>
                    <FormField label={t('consultations.height')} error={fieldError(e.height_cm)}>
                      <Input inputMode="decimal" className="tabular" {...register('height_cm')} />
                    </FormField>
                    <FormField label={t('consultations.spo2')} error={fieldError(e.spo2_percent)}>
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
              <CardHeader title={t('exam.title')} />
              <CardBody className="space-y-6 py-6">
                <p className="flex items-start gap-2 rounded-md bg-ivory px-3 py-2 text-xs text-ink-muted">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t('exam.disclaimer')}
                </p>
                <FormGrid>
                  <FormField label={t('exam.prakriti')}>
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
                <FormSection title={t('exam.doshaAssessment')}>
                  <FormGrid cols={3}>
                    {(
                      [
                        ['vata_score', 'exam.vataScore'],
                        ['pitta_score', 'exam.pittaScore'],
                        ['kapha_score', 'exam.kaphaScore'],
                      ] as const
                    ).map(([name, label]) => (
                      <FormField key={name} label={t(label)} error={fieldError(e.exam?.[name])}>
                        <Input type="number" min={0} max={10} step={1} inputMode="numeric" className="tabular" {...register(`exam.${name}`)} />
                      </FormField>
                    ))}
                  </FormGrid>
                </FormSection>
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
                        <RadioGroup name={name} legend={t(`exam.${name}`)} value={field.value || null} onChange={field.onChange} options={choice(values, name)} disabled={readOnly} />
                      )}
                    />
                  ))}
                </div>
                <FormSection title={t('exam.ashtavidha')}>
                  <FormGrid cols={4}>
                    {ASHTAVIDHA.map((k) => (
                      <FormField key={k} label={t(`exam.${k}`)} error={fieldError(e.exam?.[k])}>
                        <Input {...register(`exam.${k}`)} />
                      </FormField>
                    ))}
                  </FormGrid>
                  <FormGrid>
                    <FormField label={t('exam.sara')}>
                      <Input {...register('exam.sara')} />
                    </FormField>
                    <FormField label={t('exam.satva')}>
                      <Input {...register('exam.satva')} />
                    </FormField>
                  </FormGrid>
                </FormSection>
                <FormSection title={t('exam.lifestyleSection')}>
                  <FormGrid cols={4}>
                    {LIFESTYLE.map(([name, label]) => (
                      <FormField key={name} label={t(label)} error={fieldError(e.exam?.[name])}>
                        <Input {...register(`exam.${name}`)} />
                      </FormField>
                    ))}
                  </FormGrid>
                  <FormGrid>
                    {NARRATIVE.map(([name, label]) => (
                      <FormField key={name} label={t(label)} error={fieldError(e.exam?.[name])}>
                        <Textarea rows={2} {...register(`exam.${name}`)} />
                      </FormField>
                    ))}
                  </FormGrid>
                </FormSection>
                {(examFields.data ?? []).length > 0 && (
                  <FormSection title={t('exam.clinicFields')}>
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
                <FormField label={t('exam.notes')} error={fieldError(e.exam?.notes)}>
                  <Textarea rows={2} {...register('exam.notes')} />
                </FormField>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-6 py-6">
                <FormSection title={t('consultations.sectionAssessment')}>
                  <FormGrid>
                    <FormField label={t('consultations.findings')} error={fieldError(e.clinical_findings)}>
                      <Textarea rows={2} {...register('clinical_findings')} />
                    </FormField>
                    <FormField label={t('consultations.assessment')} error={fieldError(e.assessment)}>
                      <Textarea rows={2} {...register('assessment')} />
                    </FormField>
                  </FormGrid>
                  <FormGrid>
                    <FormField label={t('consultations.ayurvedicDiagnosis')} error={fieldError(e.ayurvedic_diagnosis)}>
                      <Input {...register('ayurvedic_diagnosis')} />
                    </FormField>
                    <FormField label={t('consultations.diagnosis')} error={fieldError(e.diagnosis)}>
                      <Input {...register('diagnosis')} />
                    </FormField>
                  </FormGrid>
                  <FormField label={t('consultations.plan')} error={fieldError(e.treatment_plan)}>
                    <Textarea rows={3} {...register('treatment_plan')} />
                  </FormField>
                  <FormGrid>
                    <FormField label={t('consultations.pathya')} error={fieldError(e.pathya)}>
                      <Textarea rows={3} {...register('pathya')} />
                    </FormField>
                    <FormField label={t('consultations.apathya')} error={fieldError(e.apathya)}>
                      <Textarea rows={3} {...register('apathya')} />
                    </FormField>
                  </FormGrid>
                  <div className="max-w-xs">
                    <FormField label={t('consultations.followUp')} error={fieldError(e.follow_up_date)}>
                      <DateInput min={c?.visit_date ?? todayISO()} {...register('follow_up_date')} />
                    </FormField>
                  </div>
                </FormSection>
              </CardBody>
            </Card>
          </fieldset>
        </form>

        <aside className="space-y-4">
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
