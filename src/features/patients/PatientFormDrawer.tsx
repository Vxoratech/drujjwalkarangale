import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid, FormSection } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Dialog';
import { DateInput, Input, RadioGroup, Select, Textarea } from '@/components/ui/Input';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useDoctors } from '@/hooks/useDoctors';
import { todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { createPatient, updatePatient } from '@/services/patients';
import { BLOOD_GROUPS, PRAKRITIS, type Patient } from '@/types/domain';
import { patientSchema, toFormValues, toPatientInput, type PatientFormValues } from './patientSchema';

export interface PatientFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient?: Patient | null;
  onSaved?: (patient: Patient) => void;
}

export function PatientFormDrawer({ open, onOpenChange, patient, onSaved }: PatientFormDrawerProps) {
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId, can, isDoctor } = useClinic();
  const { doctors } = useDoctors();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const canChooseDoctor = can('patients.read_all');

  const form = useForm<PatientFormValues>({ resolver: zodResolver(patientSchema), defaultValues: toFormValues(patient) });
  const { register, control, formState, reset } = form;
  const e = formState.errors;

  useEffect(() => {
    if (open) {
      const defaults = toFormValues(patient);
      // Doctors without clinic-wide access register patients to themselves (enforced by RLS).
      if (!patient && !canChooseDoctor && isDoctor) defaults.assigned_doctor_id = user.id;
      reset(defaults);
    }
  }, [open, patient, reset, canChooseDoctor, isDoctor, user.id]);

  const mutation = useMutation({
    mutationFn: (values: PatientFormValues) => {
      const input = toPatientInput(values);
      return patient ? updatePatient(clinicId, patient.id, input) : createPatient(clinicId, input);
    },
    onSuccess: async (saved) => {
      notify.success(patient ? t('patients.updated') : t('patients.created'));
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'patients'] });
      queryClient.setQueryData(qk.patient(clinicId, saved.id), saved);
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (error) => notify.error(error),
  });

  const formId = 'patient-form';

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}
      title={patient ? t('patients.edit') : t('patients.add')}
      width="lg"
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
        <FormSection title={t('patients.sectionIdentity')}>
          <FormGrid>
            <FormField label={t('patients.firstName')} error={fieldError(e.first_name)} required>
              <Input autoComplete="off" {...register('first_name')} />
            </FormField>
            <FormField label={t('patients.lastName')} error={fieldError(e.last_name)}>
              <Input autoComplete="off" {...register('last_name')} />
            </FormField>
            <FormField label={t('patients.dob')} error={fieldError(e.date_of_birth)}>
              <DateInput max={todayISO()} {...register('date_of_birth')} />
            </FormField>
            <FormField label={t('patients.bloodGroup')} error={fieldError(e.blood_group)}>
              <Select placeholder="—" options={BLOOD_GROUPS.map((b) => ({ value: b, label: b }))} {...register('blood_group')} />
            </FormField>
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
                options={(['female', 'male', 'other', 'undisclosed'] as const).map((g) => ({ value: g, label: t(`gender.${g}`) }))}
              />
            )}
          />
        </FormSection>

        <FormSection title={t('patients.sectionContact')}>
          <FormGrid>
            <FormField label={t('patients.phone')} error={fieldError(e.phone)}>
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
          </FormGrid>
        </FormSection>

        <FormSection title={t('patients.sectionMedical')}>
          <FormGrid>
            <FormField label={t('patients.prakriti')}>
              <Select placeholder="—" options={PRAKRITIS.map((p) => ({ value: p, label: t(`prakriti.${p}`) }))} {...register('prakriti')} />
            </FormField>
            <FormField label={t('patients.assignedDoctor')}>
              <Select
                placeholder={t('patients.unassigned')}
                disabled={!canChooseDoctor}
                options={doctors.map((d) => ({ value: d.user_id, label: d.full_name }))}
                {...register('assigned_doctor_id')}
              />
            </FormField>
          </FormGrid>
          <FormField label={t('patients.allergies')} error={fieldError(e.allergies)}>
            <Textarea rows={2} {...register('allergies')} />
          </FormField>
          <FormField label={t('patients.chronicConditions')} error={fieldError(e.chronic_conditions)}>
            <Textarea rows={2} {...register('chronic_conditions')} />
          </FormField>
        </FormSection>
      </form>
    </Drawer>
  );
}
