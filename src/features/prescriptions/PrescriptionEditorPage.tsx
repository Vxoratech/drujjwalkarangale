import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, FileCheck2, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, ErrorState, FullPageSpinner, PermissionDenied } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, buttonClasses, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { isPermissionError, toUserMessage } from '@/lib/errors';
import { formatDate, fullName } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { cancelPrescription, getPrescription, issuePrescription, savePrescriptionDraft } from '@/services/clinical';
import { getPatient } from '@/services/patients';
import { DOSE_TIMINGS, MEDICINE_FORMS } from '@/types/domain';
import { emptyItem, prescriptionSchema, toItemInputs, toPrescriptionForm, type PrescriptionFormInput, type PrescriptionFormValues } from './prescriptionSchema';

export function PrescriptionEditorPage() {
  const { prescriptionId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId, can } = useClinic();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const rxQuery = useQuery({ queryKey: qk.prescription(clinicId, prescriptionId ?? ''), queryFn: () => getPrescription(clinicId, prescriptionId!), enabled: Boolean(prescriptionId) });
  const rx = rxQuery.data;
  const patientId = prescriptionId ? rx?.patient_id : search.get('patient');
  const consultationId = prescriptionId ? rx?.consultation_id ?? null : search.get('consultation');
  const patient = useQuery({ queryKey: qk.patient(clinicId, patientId ?? ''), queryFn: () => getPatient(clinicId, patientId!), enabled: Boolean(patientId) });

  const editable = can('clinical.write') && (!rx || (rx.status === 'draft' && rx.doctor_id === user.id));

  const form = useForm<PrescriptionFormInput, unknown, PrescriptionFormValues>({ resolver: zodResolver(prescriptionSchema), defaultValues: toPrescriptionForm() });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const e = form.formState.errors;

  useEffect(() => {
    if (rx) form.reset(toPrescriptionForm(rx));
  }, [rx, form]);

  useUnsavedChangesGuard(form.formState.isDirty && editable, t('consultations.unsaved'));

  const invalidate = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: [clinicId, 'prescriptions'] }), queryClient.invalidateQueries({ queryKey: [clinicId, 'prescription'] })]);

  const save = useMutation({
    mutationFn: async ({ values, issue }: { values: PrescriptionFormValues; issue: boolean }) => {
      const id = await savePrescriptionDraft(clinicId, { patient_id: patientId!, consultation_id: consultationId, notes: values.notes || null }, toItemInputs(values), prescriptionId);
      if (issue) await issuePrescription(id);
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

  const cancel = useMutation({
    mutationFn: () => cancelPrescription(clinicId, prescriptionId!),
    onSuccess: async () => {
      await invalidate();
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
            {rx?.status === 'issued' && rx.doctor_id === user.id && (
              <Button variant="ghost" className="text-danger" leftIcon={<Ban className="size-4" />} onClick={() => setConfirmCancel(true)}>
                {t('common.cancel')}
              </Button>
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

      {p.allergies && (
        <div className="mb-4">
          <Alert tone="danger" title={t('patients.allergies')}>
            {p.allergies}
          </Alert>
        </div>
      )}

      <form noValidate onSubmit={(ev) => ev.preventDefault()}>
        <fieldset disabled={!editable || save.isPending} className="space-y-4">
          <Card>
            <CardHeader title={t('prescriptions.medicine')} />
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
                        <FormField label={t('prescriptions.dose')} error={fieldError(ie?.dose)} required className="lg:col-span-2">
                          <Input placeholder="e.g. 2 tablets / 3 g" {...form.register(`items.${index}.dose`)} />
                        </FormField>
                        <FormField label={t('prescriptions.frequency')} error={fieldError(ie?.frequency)} required className="lg:col-span-2">
                          <Input placeholder="e.g. Twice daily" {...form.register(`items.${index}.frequency`)} />
                        </FormField>
                        <FormField label={t('prescriptions.timing')} className="lg:col-span-2">
                          <Select options={DOSE_TIMINGS.map((d) => ({ value: d, label: t(`doseTiming.${d}`) }))} {...form.register(`items.${index}.timing`)} />
                        </FormField>
                        <FormField label={t('prescriptions.anupana')} error={fieldError(ie?.anupana)} className="lg:col-span-1">
                          <Input placeholder="e.g. Warm water" {...form.register(`items.${index}.anupana`)} />
                        </FormField>
                        <FormField label={t('prescriptions.duration')} error={fieldError(ie?.duration_days)} className="lg:col-span-1">
                          <Input inputMode="numeric" className="tabular" {...form.register(`items.${index}.duration_days`)} />
                        </FormField>
                        <FormField label={t('prescriptions.instructions')} error={fieldError(ie?.instructions)} className="sm:col-span-2 lg:col-span-6">
                          <Input {...form.register(`items.${index}.instructions`)} />
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
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <FormField label={t('prescriptions.notes')} error={fieldError(e.notes)}>
                <Textarea rows={3} {...form.register('notes')} />
              </FormField>
            </CardBody>
          </Card>
        </fieldset>
      </form>

      <ConfirmDialog
        open={confirmIssue}
        onOpenChange={setConfirmIssue}
        title={t('prescriptions.issueConfirmTitle')}
        body={t('prescriptions.issueConfirmBody')}
        confirmLabel={t('prescriptions.issue')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => submit(true)()}
      />
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
    </>
  );
}
