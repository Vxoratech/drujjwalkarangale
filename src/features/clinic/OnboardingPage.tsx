import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthLayout } from '@/app/layouts/AuthLayout';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Checkbox, Input } from '@/components/ui/Input';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { qk } from '@/lib/query/keys';
import { createClinicSchema } from '@/lib/validation/schemas';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { signOut } from '@/services/auth';
import { createClinic } from '@/services/clinic';

export function OnboardingPage() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const form = useForm<z.infer<typeof createClinicSchema>>({
    resolver: zodResolver(createClinicSchema),
    defaultValues: { name: '', city: '', phone: '', isPractitioner: true },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await createClinic({ name: values.name, city: values.city ?? '', phone: values.phone ?? '', isPractitioner: values.isPractitioner });
      await queryClient.invalidateQueries({ queryKey: qk.memberships(user.id) });
    } catch (error) {
      notify.error(error);
    }
  });

  return (
    <AuthLayout
      title={t('onboarding.title')}
      subtitle={t('onboarding.subtitle')}
      footer={
        <span>
          {t('onboarding.noMembershipBody')}{' '}
          <button type="button" className="font-medium text-forest hover:underline" onClick={() => void signOut()}>
            {t('common.signOut')}
          </button>
        </span>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label={t('onboarding.clinicName')} error={fieldError(form.formState.errors.name)} required>
          <Input autoComplete="organization" {...form.register('name')} />
        </FormField>
        <FormField label={t('onboarding.city')} error={fieldError(form.formState.errors.city)} optionalLabel={t('common.optional')}>
          <Input autoComplete="address-level2" {...form.register('city')} />
        </FormField>
        <FormField label={t('onboarding.phone')} error={fieldError(form.formState.errors.phone)} optionalLabel={t('common.optional')}>
          <Input type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 " {...form.register('phone')} />
        </FormField>
        <Checkbox label={t('onboarding.practitioner')} {...form.register('isPractitioner')} />
        <Button type="submit" fullWidth size="lg" loading={form.formState.isSubmitting}>
          {t('onboarding.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
