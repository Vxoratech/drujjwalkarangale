import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorState, FullPageSpinner } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { qk } from '@/lib/query/keys';
import { optionalPhone, optionalText, requiredText } from '@/lib/validation/schemas';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { fetchProfile, updateProfile } from '@/services/clinic';

const schema = z.object({
  full_name: requiredText(120, 2),
  phone: optionalPhone,
  qualification: optionalText(120),
  medical_registration_no: optionalText(60),
  preferred_locale: z.enum(['en', 'mr']),
});

export function ProfilePage() {
  const { t, setLocale } = useI18n();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const query = useQuery({ queryKey: qk.profile(user.id), queryFn: () => fetchProfile(user.id) });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    values: query.data && {
      full_name: query.data.full_name,
      phone: query.data.phone ?? '',
      qualification: query.data.qualification ?? '',
      medical_registration_no: query.data.medical_registration_no ?? '',
      preferred_locale: query.data.preferred_locale,
    },
  });
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      updateProfile(user.id, { full_name: v.full_name, phone: v.phone || null, qualification: v.qualification || null, medical_registration_no: v.medical_registration_no || null, preferred_locale: v.preferred_locale }),
    onSuccess: (p) => {
      queryClient.setQueryData(qk.profile(user.id), p);
      setLocale(p.preferred_locale);
      notify.success(t('settings.profileSaved'));
    },
    onError: (e) => notify.error(e),
  });

  if (query.isLoading) return <FullPageSpinner />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const e = form.formState.errors;

  return (
    <>
      <PageHeader title={t('settings.myProfile')} description={user.email} />
      <Card className="max-w-form">
        <CardBody className="py-6">
          <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <FormGrid>
              <FormField label={t('auth.fullName')} error={fieldError(e.full_name)} required>
                <Input autoComplete="name" {...form.register('full_name')} />
              </FormField>
              <FormField label={t('settings.phone')} error={fieldError(e.phone)}>
                <Input type="tel" autoComplete="tel" {...form.register('phone')} />
              </FormField>
              <FormField label={t('settings.qualification')} error={fieldError(e.qualification)}>
                <Input placeholder="BAMS, MD (Ayu)" {...form.register('qualification')} />
              </FormField>
              <FormField label={t('settings.medicalRegNo')} error={fieldError(e.medical_registration_no)}>
                <Input {...form.register('medical_registration_no')} />
              </FormField>
              <FormField label={t('common.language')}>
                <Select options={[{ value: 'en', label: 'English' }, { value: 'mr', label: 'मराठी' }]} {...form.register('preferred_locale')} />
              </FormField>
            </FormGrid>
            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending} disabled={!form.formState.isDirty}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
