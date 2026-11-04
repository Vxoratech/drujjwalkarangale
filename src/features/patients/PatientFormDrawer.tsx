import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid, FormSection } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { BranchSelect } from '@/components/ui/BranchFilter';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Dialog';
import { DateInput, Input, RadioGroup, Select } from '@/components/ui/Input';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { useAccess } from '@/features/access/AccessProvider';
import { formatDate, fullName, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { DUPLICATE_REVIEW_REQUIRED, findPossibleDuplicates, registerPatient, updatePatient, type PatientInput } from '@/services/patients';
import { PATIENT_STATUSES, type DuplicateCandidate, type Patient } from '@/types/domain';
import { patientSchema, toFormValues, toPatientInput, type PatientFormInput, type PatientFormValues } from './patientSchema';

export interface PatientFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient?: Patient | null;
  onSaved?: (patient: Patient) => void;
}

/**
 * Registration and editing of the central patient profile. New registrations
 * are checked for likely duplicates first; the user either opens the existing
 * record or confirms this is a different person (the server enforces the same
 * check and records the confirmation).
 */
export function PatientFormDrawer({ open, onOpenChange, patient, onSaved }: PatientFormDrawerProps) {
  const { t } = useI18n();
  const { can, defaultBranchId, branches } = useAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const [branchId, setBranchId] = useState(defaultBranchId ?? '');
  const [review, setReview] = useState<{ input: PatientInput; candidates: DuplicateCandidate[] } | null>(null);
  // Contact-only editors may not change identity fields (enforced by the database too).
  const identityLocked = Boolean(patient) && !can('patients.edit');
  const canChangeStatus = can('patients.edit') || can('patients.delete');

  const form = useForm<PatientFormInput, unknown, PatientFormValues>({ resolver: zodResolver(patientSchema), defaultValues: toFormValues(patient) });
  const { register, control, formState, reset } = form;
  const e = formState.errors;

  useEffect(() => {
    if (open) {
      reset(toFormValues(patient));
      setReview(null);
      setBranchId(defaultBranchId ?? '');
    }
  }, [open, patient, reset, defaultBranchId]);

  async function saved(row: Patient) {
    notify.success(patient ? t('patients.updated') : t('patients.created'));
    await queryClient.invalidateQueries({ queryKey: ['patients'] });
    queryClient.setQueryData(qk.patient(row.id), row);
    onOpenChange(false);
    onSaved?.(row);
  }

  const register_ = useMutation({
    mutationFn: async ({ input, reviewed }: { input: PatientInput; reviewed: boolean }): Promise<{ patient: Patient } | { candidates: DuplicateCandidate[]; input: PatientInput }> => {
      if (!reviewed) {
        const candidates = await findPossibleDuplicates(input);
        if (candidates.length > 0) return { candidates, input };
      }
      return { patient: await registerPatient(input, branchId || null, reviewed) };
    },
    onSuccess: (result) => {
      if ('candidates' in result) setReview({ input: result.input, candidates: result.candidates });
      else void saved(result.patient);
    },
    onError: (error, vars) => {
      // Someone registered a similar patient meanwhile: show the review instead.
      if ((error as { code?: string }).code === DUPLICATE_REVIEW_REQUIRED) {
        void findPossibleDuplicates(vars.input).then((candidates) => setReview({ input: vars.input, candidates }));
      } else notify.error(error);
    },
  });

  const update = useMutation({
    mutationFn: (input: PatientInput) => updatePatient(patient!.id, input),
    onSuccess: (row) => void saved(row),
    onError: (error) => notify.error(error),
  });

  const pending = register_.isPending || update.isPending;
  const formId = 'patient-form';

  function submit(values: PatientFormValues) {
    const input = toPatientInput(values);
    if (patient) update.mutate(input);
    else register_.mutate({ input, reviewed: false });
  }

  const footer = review ? (
    <>
      <Button variant="secondary" leftIcon={<ArrowLeft className="size-4" />} onClick={() => setReview(null)} disabled={pending}>
        {t('patients.backToForm')}
      </Button>
      <Button leftIcon={<UserPlus className="size-4" />} loading={pending} onClick={() => register_.mutate({ input: review.input, reviewed: true })}>
        {t('patients.registerAnyway')}
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" form={formId} loading={pending}>
        {patient ? t('common.save') : t('patients.register')}
      </Button>
    </>
  );

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={review ? t('patients.duplicatesTitle') : patient ? t('patients.edit') : t('patients.add')}
      width="lg"
      closeLabel={t('common.close')}
      footer={footer}
    >
      {review ? (
        <div className="space-y-4">
          <Alert tone="warning" icon={<Copy />} title={t('patients.duplicatesFound', { count: review.candidates.length })}>
            {t('patients.duplicatesBody')}
          </Alert>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {review.candidates.map((c) => (
              <li key={c.patient_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <PatientIdentity
                    name={fullName(c)}
                    code={c.patient_code}
                    meta={[c.phone, c.date_of_birth && formatDate(c.date_of_birth), c.registered_branch].filter(Boolean).join(' · ')}
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {c.match_reasons.map((r) => (
                      <Badge key={r} tone="gold">
                        {t(`patients.matchReason.${r}`)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/patients/${c.patient_id}`);
                  }}
                >
                  {t('patients.openExisting')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form id={formId} noValidate onSubmit={form.handleSubmit(submit)} className="space-y-6">
          <p className="text-sm text-ink-muted">{t('patients.dataMinimisation')}</p>
          {identityLocked && <Alert tone="info">{t('patients.contactOnly')}</Alert>}
          <FormSection title={t('patients.sectionIdentity')}>
            <FormGrid>
              <FormField label={t('patients.firstName')} error={fieldError(e.first_name)} required>
                <Input autoComplete="off" disabled={identityLocked} {...register('first_name')} />
              </FormField>
              <FormField label={t('patients.lastName')} error={fieldError(e.last_name)}>
                <Input autoComplete="off" disabled={identityLocked} {...register('last_name')} />
              </FormField>
              <FormField label={t('patients.dob')} error={fieldError(e.date_of_birth)}>
                <DateInput max={todayISO()} disabled={identityLocked} {...register('date_of_birth')} />
              </FormField>
              <FormField label={t('patients.approxAge')} hint={t('patients.approxAgeHint')} error={fieldError(e.approx_age_years)}>
                <Input inputMode="numeric" className="tabular" disabled={identityLocked} {...register('approx_age_years')} />
              </FormField>
              <FormField label={t('patients.occupation')} error={fieldError(e.occupation)}>
                <Input autoComplete="off" disabled={identityLocked} {...register('occupation')} />
              </FormField>
              {!patient && branches.length > 1 && (
                <FormField label={t('patients.registeredAt')} hint={t('patients.registeredAtHint')}>
                  <BranchSelect value={branchId} onChange={setBranchId} />
                </FormField>
              )}
            </FormGrid>
            <Controller
              control={control}
              name="gender"
              render={({ field }) => (
                <RadioGroup
                  name="gender"
                  legend={t('patients.gender')}
                  value={field.value}
                  onChange={field.onChange}
                  disabled={identityLocked}
                  options={(['female', 'male', 'other', 'undisclosed'] as const).map((g) => ({ value: g, label: t(`gender.${g}`) }))}
                />
              )}
            />
          </FormSection>

          <FormSection title={t('patients.sectionContact')}>
            <FormGrid>
              <FormField label={t('patients.phone')} hint={!patient ? t('patients.phoneDuplicateHint') : undefined} error={fieldError(e.phone)}>
                <Input type="tel" inputMode="tel" autoComplete="off" placeholder="+91 " {...register('phone')} />
              </FormField>
              <FormField label={t('patients.email')} error={fieldError(e.email)}>
                <Input type="email" autoComplete="off" {...register('email')} />
              </FormField>
              <FormField label={t('patients.address')} error={fieldError(e.address_line)} className="sm:col-span-2">
                <Input autoComplete="off" {...register('address_line')} />
              </FormField>
              <FormField label={t('patients.city')} error={fieldError(e.city)}>
                <Input autoComplete="off" {...register('city')} />
              </FormField>
              <FormField label={t('patients.preferredLanguage')}>
                <Select
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'mr', label: 'मराठी' },
                  ]}
                  {...register('preferred_locale')}
                />
              </FormField>
              <FormField label={t('patients.emergencyName')} error={fieldError(e.emergency_contact_name)}>
                <Input autoComplete="off" {...register('emergency_contact_name')} />
              </FormField>
              <FormField label={t('patients.emergencyPhone')} error={fieldError(e.emergency_contact_phone)}>
                <Input type="tel" inputMode="tel" autoComplete="off" {...register('emergency_contact_phone')} />
              </FormField>
              {patient && canChangeStatus && (
                <FormField label={t('patients.status')}>
                  <Select options={PATIENT_STATUSES.map((s) => ({ value: s, label: t(`patientStatus.${s}`) }))} {...register('status')} />
                </FormField>
              )}
            </FormGrid>
          </FormSection>
        </form>
      )}
    </Drawer>
  );
}
