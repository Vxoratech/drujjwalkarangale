import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BookmarkPlus, FileCheck2, FilePen, History, LayoutTemplate, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, ErrorState, FullPageSpinner, PermissionDenied } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button, buttonClasses, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Modal } from '@/components/ui/Dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { Checkbox, DateInput, Input, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useDoctors } from '@/hooks/useDoctors';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { isPermissionError, toUserMessage } from '@/lib/errors';
import { ageLabel, formatDate, formatDateTime, fullName, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import {
  cancelPrescription,
  getPrescription,
  issuePrescription,
  listPrescriptionRevisions,
  listTemplates,
  revisePrescription,
  savePrescriptionDraft,
  saveTemplate,
} from '@/services/clinical';
import { getPatient } from '@/services/patients';
import { DOSE_TIMINGS, MEDICINE_FORMS, MEDICINE_ROUTES } from '@/types/domain';
import {
  emptyItem,
  prescriptionSchema,
  templateToItems,
  toHeaderInput,
  toItemInputs,
  toPrescriptionForm,
  type PrescriptionFormInput,
  type PrescriptionFormValues,
} from './prescriptionSchema';

export function PrescriptionEditorPage() {
  const { prescriptionId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId, clinic, can } = useClinic();
  const { names } = useDoctors();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseReason, setReviseReason] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateShared, setTemplateShared] = useState(false);

  const rxQuery = useQuery({ queryKey: qk.prescription(clinicId, prescriptionId ?? ''), queryFn: () => getPrescription(clinicId, prescriptionId!), enabled: Boolean(prescriptionId) });
  const rx = rxQuery.data;
  const patientId = prescriptionId ? rx?.patient_id : search.get('patient');
  const consultationId = prescriptionId ? rx?.consultation_id ?? null : search.get('consultation');
  const patient = useQuery({ queryKey: qk.patient(clinicId, patientId ?? ''), queryFn: () => getPatient(clinicId, patientId!), enabled: Boolean(patientId) });
  const revisions = useQuery({ queryKey: [clinicId, 'prescription-revisions', prescriptionId], queryFn: () => listPrescriptionRevisions(prescriptionId!), enabled: Boolean(prescriptionId) });

  const isOwner = !rx || rx.doctor_id === user.id;
  const editable = can('clinical.write') && isOwner && (!rx || rx.status === 'draft');
  const templates = useQuery({ queryKey: [clinicId, 'rx-templates'], queryFn: () => listTemplates(clinicId), enabled: editable });

  const form = useForm<PrescriptionFormInput, unknown, PrescriptionFormValues>({ resolver: zodResolver(prescriptionSchema), defaultValues: toPrescriptionForm() });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const e = form.formState.errors;

  useEffect(() => {
    if (rx) form.reset(toPrescriptionForm(rx));
    else if (patient.data) {
      const pref = clinic.settings.prescription_language;
      form.reset(toPrescriptionForm(null, pref === 'en' || pref === 'mr' ? pref : patient.data.preferred_locale));
    }
  }, [rx, patient.data, form, clinic.settings.prescription_language]);

  useUnsavedChangesGuard(form.formState.isDirty && editable, t('consultations.unsaved'));

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [clinicId, 'prescriptions'] }),
      queryClient.invalidateQueries({ queryKey: [clinicId, 'prescription'] }),
      queryClient.invalidateQueries({ queryKey: [clinicId, 'prescription-revisions'] }),
    ]);

  const save = useMutation({
    mutationFn: async ({ values, issue }: { values: PrescriptionFormValues; issue: boolean }) => {
      const id = await savePrescriptionDraft(clinicId, { patient_id: patientId!, consultation_id: consultationId, header: toHeaderInput(values) }, toItemInputs(values), prescriptionId);
      if (issue) await issuePrescription(id, reviewed);
      return { id, issue };
    },
    onSuccess: async ({ id, issue }) => {
      notify.success(issue ? t('prescriptions.issued') : t('prescriptions.saved'));
      form.reset(form.getValues());
      await invalidate();
      if (!prescriptionId) navigate(`/prescriptions/${id}`, { replace: true });
    },
    onError: (err) => notify.error(err),
  });

  const cancel = useMutation({ mutationFn: () => cancelPrescription(clinicId, prescriptionId!), onSuccess: invalidate, onError: (err) => notify.error(err) });
  const revise = useMutation({
    mutationFn: () => revisePrescription(prescriptionId!, reviseReason),
    onSuccess: async () => {
      notify.success(t('prescriptions.revised'));
      setReviseReason('');
      await invalidate();
    },
    onError: (err) => notify.error(err),
  });
  const createTemplate = useMutation({
    mutationFn: async () => {
      const ok = await form.trigger('items');
      if (!ok) throw { message: t('validation.required') };
      const values = prescriptionSchema.parse(form.getValues());
      await saveTemplate(clinicId, { name: templateName.trim(), items: toItemInputs(values), patient_instructions: values.patient_instructions || null, is_shared: templateShared });
    },
    onSuccess: async () => {
      notify.success(t('prescriptions.templateSaved'));
      setTemplateOpen(false);
      setTemplateName('');
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'rx-templates'] });
    },
    onError: (err) => notify.error(err),
  });

  if ((prescriptionId && rxQuery.isLoading) || (patientId && patient.isLoading)) return <FullPageSpinner />;
  const loadError = rxQuery.error ?? patient.error;
  if (loadError) {
    if (isPermissionError(loadError) || (loadError as { code?: string }).code === 'PGRST116') return <PermissionDenied />;
    return <ErrorState message={toUserMessage(loadError)} />;
  }
  if (!patient.data) return <ErrorState message={t('states.notFoundBody')} />;
  const p = patient.data;

  const submit = (issue: boolean) =>
    form.handleSubmit((values) => {
      if (issue && values.items.length === 0) {
        notify.info(t('prescriptions.noItems'));
        return Promise.resolve();
      }
      return save.mutateAsync({ values, issue });
    });

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('nav.patients'), to: '/patients' },
          { label: fullName(p), to: `/patients/${p.id}` },
          ...(consultationId ? [{ label: t('consultations.title'), to: `/consultations/${consultationId}` }] : []),
          { label: rx?.prescription_no ?? t('prescriptions.title') },
        ]}
        title={rx?.prescription_no ?? t('prescriptions.new')}
        meta={
          <>
            <PatientIdentity name={fullName(p)} code={p.patient_code} />
            {rx && <StatusBadge status={rx.status} label={t(`prescriptionStatus.${rx.status}`)} />}
            {rx && rx.revision_number > 1 && <Badge tone="gold">{t('prescriptions.revisionN', { n: rx.revision_number })}</Badge>}
            {rx?.issued_at && <span className="tabular text-sm text-ink-muted">{formatDate(rx.issued_at)}</span>}
          </>
        }
        actions={
          <>
            {rx?.status === 'issued' && (
              <Link to={`/print/prescriptions/${rx.id}`} target="_blank" rel="noopener" className={buttonClasses('secondary')}>
                <Printer className="size-4" aria-hidden /> {t('common.print')}
              </Link>
            )}
            {rx?.status === 'issued' && isOwner && can('clinical.write') && (
              <>
                <Button variant="secondary" leftIcon={<FilePen className="size-4" />} onClick={() => setReviseOpen(true)}>
                  {t('prescriptions.revise')}
                </Button>
                <Button variant="ghost" className="text-danger" leftIcon={<Ban className="size-4" />} onClick={() => setConfirmCancel(true)}>
                  {t('common.cancel')}
                </Button>
              </>
            )}
            {editable && (
              <>
                <Button variant="secondary" leftIcon={<Save className="size-4" />} loading={save.isPending && !confirmIssue} onClick={() => void submit(false)()}>
                  {t('common.saveDraft')}
                </Button>
                <Button leftIcon={<FileCheck2 className="size-4" />} onClick={() => void form.trigger().then((ok) => ok && setConfirmIssue(true))}>
                  {t('prescriptions.issue')}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 space-y-3">
        {p.allergies && (
          <Alert tone="danger" title={t('patients.allergies')}>
            {p.allergies}
          </Alert>
        )}
        {rx?.revision_reason && rx.status === 'draft' && (
          <Alert tone="warning" title={t('prescriptions.reviseReason')}>
            {rx.revision_reason}
          </Alert>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <form noValidate onSubmit={(ev) => ev.preventDefault()}>
          <fieldset disabled={!editable || save.isPending} className="space-y-4">
            <Card>
              <CardHeader
                title={t('prescriptions.medicine')}
                actions={
                  editable && (
                    <>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="secondary" leftIcon={<LayoutTemplate className="size-4" />}>
                            {t('prescriptions.applyTemplate')}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuLabel>{t('prescriptions.templates')}</DropdownMenuLabel>
                          {(templates.data ?? []).length === 0 ? (
                            <p className="px-2.5 py-2 text-sm text-ink-muted">{t('prescriptions.noTemplates')}</p>
                          ) : (
                            templates.data!.map((tpl) => (
                              <DropdownMenuItem
                                key={tpl.id}
                                onSelect={() => {
                                  items.replace(templateToItems(tpl));
                                  if (tpl.patient_instructions && !form.getValues('patient_instructions')) form.setValue('patient_instructions', tpl.patient_instructions, { shouldDirty: true });
                                  notify.info(t('prescriptions.templateApplied'));
                                }}
                              >
                                <span className="flex flex-col">
                                  <span>{tpl.name}</span>
                                  {tpl.owner_id !== user.id && <span className="text-xs text-ink-muted">{names.get(tpl.owner_id)}</span>}
                                </span>
                              </DropdownMenuItem>
                            ))
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button size="sm" variant="ghost" leftIcon={<BookmarkPlus className="size-4" />} onClick={() => setTemplateOpen(true)}>
                        {t('prescriptions.saveTemplate')}
                      </Button>
                    </>
                  )
                }
              />
              <CardBody className="space-y-4">
                {items.fields.length === 0 && <p className="text-sm text-ink-muted">{t('prescriptions.noItems')}</p>}
                <ol className="space-y-4">
                  {items.fields.map((field, index) => {
                    const ie = e.items?.[index];
                    return (
                      <li key={field.id} className="rounded-lg border border-line bg-ivory/40 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="tabular text-sm font-semibold text-forest-deep">{index + 1}.</span>
                          {editable && <IconButton size="sm" label={`${t('common.remove')} ${index + 1}`} icon={<Trash2 />} onClick={() => items.remove(index)} />}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                          <FormField label={t('prescriptions.medicine')} error={fieldError(ie?.medicine_name)} required className="lg:col-span-3">
                            <Input {...form.register(`items.${index}.medicine_name`)} />
                          </FormField>
                          <FormField label={t('prescriptions.form')} className="lg:col-span-1">
                            <Select options={MEDICINE_FORMS.map((f) => ({ value: f, label: t(`medicineForm.${f}`) }))} {...form.register(`items.${index}.form`)} />
                          </FormField>
                          <FormField label={t('prescriptions.route')} className="lg:col-span-2">
                            <Select options={MEDICINE_ROUTES.map((r) => ({ value: r, label: t(`medicineRoute.${r}`) }))} {...form.register(`items.${index}.route`)} />
                          </FormField>
                          <FormField label={t('prescriptions.dose')} error={fieldError(ie?.dose)} required className="lg:col-span-2">
                            <Input {...form.register(`items.${index}.dose`)} />
                          </FormField>
                          <FormField label={t('prescriptions.frequency')} error={fieldError(ie?.frequency)} required className="lg:col-span-2">
                            <Input {...form.register(`items.${index}.frequency`)} />
                          </FormField>
                          <FormField label={t('prescriptions.timing')} className="lg:col-span-2">
                            <Select options={DOSE_TIMINGS.map((d) => ({ value: d, label: t(`doseTiming.${d}`) }))} {...form.register(`items.${index}.timing`)} />
                          </FormField>
                          <FormField label={t('prescriptions.anupana')} error={fieldError(ie?.anupana)} className="lg:col-span-2">
                            <Input {...form.register(`items.${index}.anupana`)} />
                          </FormField>
                          <FormField label={t('prescriptions.duration')} error={fieldError(ie?.duration_days)} className="lg:col-span-2">
                            <Input inputMode="numeric" className="tabular" {...form.register(`items.${index}.duration_days`)} />
                          </FormField>
                          <FormField label={t('prescriptions.quantity')} error={fieldError(ie?.quantity)} className="lg:col-span-2">
                            <Input {...form.register(`items.${index}.quantity`)} />
                          </FormField>
                          <FormField label={t('prescriptions.instructionsEn')} error={fieldError(ie?.instructions_en)} className="sm:col-span-2 lg:col-span-3">
                            <Input {...form.register(`items.${index}.instructions_en`)} />
                          </FormField>
                          <FormField label={t('prescriptions.instructionsMr')} error={fieldError(ie?.instructions_mr)} className="sm:col-span-2 lg:col-span-3">
                            <Input lang="mr" {...form.register(`items.${index}.instructions_mr`)} />
                          </FormField>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {editable && (
                  <Button variant="subtle" leftIcon={<Plus className="size-4" />} onClick={() => items.append(emptyItem())} disabled={items.fields.length >= 50}>
                    {t('prescriptions.addMedicine')}
                  </Button>
                )}
                {editable && <p className="text-xs text-ink-muted">{t('prescriptions.templateDisclaimer')}</p>}
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-4">
                <FormGrid>
                  <FormField label={t('prescriptions.language')}>
                    <Select options={[{ value: 'en', label: 'English' }, { value: 'mr', label: 'मराठी' }]} {...form.register('language')} />
                  </FormField>
                  <FormField label={t('prescriptions.followUp')} error={fieldError(e.follow_up_date)}>
                    <DateInput min={todayISO()} {...form.register('follow_up_date')} />
                  </FormField>
                </FormGrid>
                <FormField label={t('prescriptions.patientInstructions')} error={fieldError(e.patient_instructions)}>
                  <Textarea rows={3} {...form.register('patient_instructions')} />
                </FormField>
                <FormField label={t('prescriptions.notes')} error={fieldError(e.notes)}>
                  <Textarea rows={2} {...form.register('notes')} />
                </FormField>
              </CardBody>
            </Card>
          </fieldset>
        </form>

        <aside className="space-y-4">
          <Card>
            <CardHeader title={t('prescriptions.context')} />
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-ink-muted">{t('billing.patient')}</dt>
                  <dd className="font-medium">
                    {fullName(p)} <span className="tabular text-xs text-ink-muted">{p.patient_code}</span>
                  </dd>
                  <dd className="text-xs text-ink-muted">{[ageLabel(p) !== '—' ? `${ageLabel(p)} y` : null, t(`gender.${p.gender}`), p.preferred_locale === 'mr' ? 'मराठी' : 'English'].filter(Boolean).join(' · ')}</dd>
                </div>
                {consultationId && (
                  <div>
                    <dt className="text-xs text-ink-muted">{t('consultations.title')}</dt>
                    <dd>
                      <Link to={`/consultations/${consultationId}`} className="text-forest hover:underline">
                        {t('common.view')}
                      </Link>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-ink-muted">{t('appointments.doctor')}</dt>
                  <dd>{names.get(rx?.doctor_id ?? user.id) ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{t('prescriptions.reference')}</dt>
                  <dd className="tabular">{rx?.prescription_no ?? t('prescriptions.assignedOnIssue')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{t('billing.date')}</dt>
                  <dd className="tabular">{formatDate(rx?.issued_at ?? rx?.created_at ?? todayISO())}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('prescriptions.revisions')} />
            <CardBody>
              {(revisions.data ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">—</p>
              ) : (
                <ol className="space-y-3">
                  {revisions.data!.map((r) => (
                    <li key={r.id} className="flex gap-3 text-sm">
                      <History className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden />
                      <div>
                        <p className="font-medium">{t('prescriptions.revisionN', { n: r.revision_number })}</p>
                        <p className="tabular text-xs text-ink-muted">
                          {formatDateTime(r.issued_at)} · {names.get(r.issued_by) ?? ''}
                        </p>
                        {r.revision_reason && <p className="text-xs text-ink-muted">{r.revision_reason}</p>}
                        <p className="text-xs text-ink-muted">{r.snapshot.items.map((i) => i.medicine_name).join(', ')}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmIssue}
        onOpenChange={(o) => {
          setConfirmIssue(o);
          if (!o) setReviewed(false);
        }}
        title={t('prescriptions.issueConfirmTitle')}
        body={t('prescriptions.issueConfirmBody')}
        confirmLabel={t('prescriptions.issue')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={!reviewed}
        onConfirm={() => submit(true)()}
      >
        <Checkbox label={t('prescriptions.clinicianReview')} description={t('prescriptions.clinicianReviewHint')} checked={reviewed} onChange={(ev) => setReviewed(ev.target.checked)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={reviseOpen}
        onOpenChange={setReviseOpen}
        title={t('prescriptions.reviseTitle')}
        body={t('prescriptions.reviseBody')}
        confirmLabel={t('prescriptions.revise')}
        cancelLabel={t('common.back')}
        confirmDisabled={!reviseReason.trim()}
        onConfirm={() => revise.mutateAsync()}
      >
        <FormField label={t('prescriptions.reviseReason')} required>
          <Textarea rows={2} maxLength={500} value={reviseReason} onChange={(ev) => setReviseReason(ev.target.value)} />
        </FormField>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`${t('common.cancel')} ${rx?.prescription_no ?? ''}`}
        body={t('prescriptions.issueConfirmBody')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.back')}
        tone="danger"
        onConfirm={() => cancel.mutateAsync()}
      />
      <Modal
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        title={t('prescriptions.saveTemplate')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTemplateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={createTemplate.isPending} disabled={templateName.trim().length < 2} onClick={() => createTemplate.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label={t('prescriptions.templateName')} required>
            <Input maxLength={120} value={templateName} onChange={(ev) => setTemplateName(ev.target.value)} />
          </FormField>
          <Checkbox label={t('prescriptions.shareTemplate')} checked={templateShared} onChange={(ev) => setTemplateShared(ev.target.checked)} />
          <p className="text-xs text-ink-muted">{t('prescriptions.templateDisclaimer')}</p>
        </div>
      </Modal>
    </>
  );
}
