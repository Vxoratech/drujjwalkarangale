import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Dialog';
import { Select, Textarea } from '@/components/ui/Input';
import { useAccess } from '@/features/access/AccessProvider';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { saveMedicalProfile } from '@/services/patients';
import { BLOOD_GROUPS, PRAKRITIS, type MedicalProfile, type UUID } from '@/types/domain';
import { medicalSchema, toMedicalForm, toMedicalInput, type MedicalFormValues } from './patientSchema';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children || <span className="text-ink-muted">—</span>}</dd>
    </div>
  );
}

/** Medical background: visible with the history permission, edited by the doctor only. */
export function MedicalProfileCard({ patientId, profile, loading }: { patientId: UUID; profile: MedicalProfile | null; loading: boolean }) {
  const { t } = useI18n();
  const { can } = useAccess();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const [open, setOpen] = useState(false);
  const form = useForm<MedicalFormValues>({ resolver: zodResolver(medicalSchema), defaultValues: toMedicalForm(profile) });
  const e = form.formState.errors;

  const save = useMutation({
    mutationFn: (v: MedicalFormValues) => saveMedicalProfile(patientId, toMedicalInput(v)),
    onSuccess: async () => {
      notify.success(t('patients.medicalSaved'));
      await queryClient.invalidateQueries({ queryKey: ['medical-profile', patientId] });
      setOpen(false);
    },
    onError: (err) => notify.error(err),
  });

  return (
    <Card>
      <CardHeader
        title={t('patients.sectionMedical')}
        actions={
          can('consultations.edit') && (
            <IconButton
              label={t('common.edit')}
              icon={<Pencil />}
              onClick={() => {
                form.reset(toMedicalForm(profile));
                setOpen(true);
              }}
            />
          )
        }
      />
      <CardBody>
        {loading ? (
          <SkeletonRows rows={3} />
        ) : (
          <dl className="space-y-4">
            <Detail label={t('patients.prakriti')}>{profile?.prakriti && t(`prakriti.${profile.prakriti}`)}</Detail>
            <Detail label={t('patients.bloodGroup')}>{profile?.blood_group}</Detail>
            <Detail label={t('patients.chronicConditions')}>{profile?.chronic_conditions && <span className="whitespace-pre-line">{profile.chronic_conditions}</span>}</Detail>
            <Detail label={t('patients.allergies')}>{profile?.allergies}</Detail>
          </dl>
        )}
      </CardBody>
      <Modal
        open={open}
        onOpenChange={(o) => !save.isPending && setOpen(o)}
        title={t('patients.sectionMedical')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="medical-form" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form id="medical-form" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <FormGrid>
            <FormField label={t('patients.prakriti')}>
              <Select placeholder="—" options={PRAKRITIS.map((p) => ({ value: p, label: t(`prakriti.${p}`) }))} {...form.register('prakriti')} />
            </FormField>
            <FormField label={t('patients.bloodGroup')}>
              <Select placeholder="—" options={BLOOD_GROUPS.map((b) => ({ value: b, label: b }))} {...form.register('blood_group')} />
            </FormField>
          </FormGrid>
          <FormField label={t('patients.allergies')} error={fieldError(e.allergies)}>
            <Textarea rows={2} {...form.register('allergies')} />
          </FormField>
          <FormField label={t('patients.chronicConditions')} error={fieldError(e.chronic_conditions)}>
            <Textarea rows={2} {...form.register('chronic_conditions')} />
          </FormField>
        </form>
      </Modal>
    </Card>
  );
}
