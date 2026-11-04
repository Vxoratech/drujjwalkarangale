import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid, FormSection } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { paiseToRupees, rupeesToPaise } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { optionalEmail, optionalPhone, optionalText, requiredText } from '@/lib/validation/schemas';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { updateOrganization, updateSettings } from '@/services/organization';
import type { Organization, OrganizationSettings } from '@/types/domain';
import { ExamFieldsCard } from './ExamFieldsCard';
import { PreferencesCard } from './PreferencesCard';

const clinicSchema = z.object({
  name: requiredText(120, 2),
  legal_name: optionalText(160),
  phone: optionalPhone,
  email: optionalEmail,
  address_line: optionalText(240),
  city: optionalText(80),
  state: optionalText(80),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'pincode').optional().or(z.literal('')),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'gstin').optional().or(z.literal('')),
  registration_no: optionalText(60),
  invoice_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, 'range:2:8'),
  consultation_fee: z.union([z.string(), z.number()]).transform((v) => (v === '' ? 0 : rupeesToPaise(v))).refine((v) => Number.isFinite(v) && v >= 0, 'range:0:100000'),
  default_locale: z.enum(['en', 'mr']),
  timezone: z.string().min(1),
  audit_retention_days: z.union([z.string(), z.number()]).pipe(z.coerce.number().int().min(1095).max(7300)),
});
type ClinicFormInput = z.input<typeof clinicSchema>;
type ClinicFormValues = z.output<typeof clinicSchema>;

const blankToNull = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

function toForm(c: Organization, st: OrganizationSettings): ClinicFormInput {
  return {
    name: c.name,
    legal_name: c.legal_name ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    address_line: c.address_line ?? '',
    city: c.city ?? '',
    state: c.state ?? '',
    pincode: c.pincode ?? '',
    gstin: c.gstin ?? '',
    registration_no: c.registration_no ?? '',
    invoice_prefix: st.invoice_prefix,
    consultation_fee: String(paiseToRupees(st.consultation_fee_paise)),
    default_locale: st.default_locale,
    timezone: st.timezone,
    audit_retention_days: String(st.audit_retention_days),
  };
}

const COMMON_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Colombo', 'Asia/Singapore', 'Europe/London', 'America/New_York'];
function timeZoneOptions(current: string) {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : COMMON_ZONES;
  return [...new Set([current, ...COMMON_ZONES, ...all])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }));
}

export function SettingsPage() {
  const { t } = useI18n();
  const { organization, settings } = useAccess();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();

  const form = useForm<ClinicFormInput, unknown, ClinicFormValues>({ resolver: zodResolver(clinicSchema), values: toForm(organization, settings) });
  const e = form.formState.errors;

  const mutation = useMutation({
    mutationFn: async (v: ClinicFormValues) => {
      const org = await updateOrganization(organization.id, {
        name: v.name,
        legal_name: blankToNull(v.legal_name),
        phone: blankToNull(v.phone),
        email: blankToNull(v.email),
        address_line: blankToNull(v.address_line),
        city: blankToNull(v.city),
        state: blankToNull(v.state),
        pincode: blankToNull(v.pincode),
        gstin: blankToNull(v.gstin),
        registration_no: blankToNull(v.registration_no),
      });
      const st = await updateSettings(organization.id, {
        invoice_prefix: v.invoice_prefix,
        consultation_fee_paise: v.consultation_fee,
        default_locale: v.default_locale,
        timezone: v.timezone,
        audit_retention_days: v.audit_retention_days,
      });
      return { org, st };
    },
    onSuccess: ({ org, st }) => {
      notify.success(t('settings.saved'));
      queryClient.setQueryData(qk.organization(), org);
      queryClient.setQueryData(qk.settings(), st);
    },
    onError: (err) => notify.error(err),
  });

  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader title={t('settings.profile')} />
          <CardBody className="py-6">
            <form noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
              <fieldset disabled={mutation.isPending} className="space-y-6">
                <FormSection title={t('settings.profile')}>
                  <FormGrid>
                    <FormField label={t('settings.name')} error={fieldError(e.name)} required>
                      <Input {...form.register('name')} />
                    </FormField>
                    <FormField label={t('settings.legalName')} error={fieldError(e.legal_name)}>
                      <Input {...form.register('legal_name')} />
                    </FormField>
                    <FormField label={t('settings.phone')} error={fieldError(e.phone)}>
                      <Input type="tel" {...form.register('phone')} />
                    </FormField>
                    <FormField label={t('settings.email')} error={fieldError(e.email)}>
                      <Input type="email" {...form.register('email')} />
                    </FormField>
                    <FormField label={t('settings.address')} error={fieldError(e.address_line)} className="sm:col-span-2">
                      <Input {...form.register('address_line')} />
                    </FormField>
                  </FormGrid>
                  <FormGrid cols={3}>
                    <FormField label={t('settings.city')} error={fieldError(e.city)}>
                      <Input {...form.register('city')} />
                    </FormField>
                    <FormField label={t('settings.state')} error={fieldError(e.state)}>
                      <Input {...form.register('state')} />
                    </FormField>
                    <FormField label={t('settings.pincode')} error={fieldError(e.pincode)}>
                      <Input inputMode="numeric" className="tabular" {...form.register('pincode')} />
                    </FormField>
                  </FormGrid>
                  <FormGrid>
                    <FormField label={t('settings.gstin')} error={fieldError(e.gstin)}>
                      <Input className="uppercase" {...form.register('gstin')} />
                    </FormField>
                    <FormField label={t('settings.registrationNo')} error={fieldError(e.registration_no)}>
                      <Input {...form.register('registration_no')} />
                    </FormField>
                  </FormGrid>
                </FormSection>
                <FormSection title={t('settings.billingDefaults')}>
                  <FormGrid cols={3}>
                    <FormField label={t('settings.invoicePrefix')} error={fieldError(e.invoice_prefix)} required>
                      <Input className="uppercase" maxLength={8} {...form.register('invoice_prefix')} />
                    </FormField>
                    <FormField label={t('settings.consultationFee')} error={fieldError(e.consultation_fee)}>
                      <Input inputMode="decimal" className="tabular" {...form.register('consultation_fee')} />
                    </FormField>
                    <FormField label={t('settings.defaultLanguage')}>
                      <Select options={[{ value: 'en', label: 'English' }, { value: 'mr', label: 'मराठी' }]} {...form.register('default_locale')} />
                    </FormField>
                    <FormField label={t('settings.timezone')}>
                      <Select options={timeZoneOptions(settings.timezone)} {...form.register('timezone')} />
                    </FormField>
                    <FormField label={t('settings.auditRetention')} error={fieldError(e.audit_retention_days)}>
                      <Input inputMode="numeric" className="tabular" {...form.register('audit_retention_days')} />
                    </FormField>
                  </FormGrid>
                </FormSection>
                <div className="flex justify-end">
                  <Button type="submit" loading={mutation.isPending} disabled={!form.formState.isDirty}>
                    {t('common.save')}
                  </Button>
                </div>
              </fieldset>
            </form>
          </CardBody>
        </Card>
        <div className="space-y-6 self-start">
          <PreferencesCard />
        </div>
      </div>
      <div className="mt-6 space-y-6">
        <ExamFieldsCard />
      </div>
    </>
  );
}
