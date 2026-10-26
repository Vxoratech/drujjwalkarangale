import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid, FormSection } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Dialog';
import { Checkbox, Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { paiseToRupees, rupeesToPaise } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { optionalEmail, optionalPhone, optionalText, requiredText } from '@/lib/validation/schemas';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { fetchBranches, saveBranch, updateClinic } from '@/services/clinic';
import type { Branch, Clinic } from '@/types/domain';
import { ExamFieldsCard } from './ExamFieldsCard';
import { SubscriptionCard } from './SubscriptionCard';

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

function toForm(c: Clinic): ClinicFormInput {
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
    invoice_prefix: c.invoice_prefix,
    consultation_fee: String(paiseToRupees(c.consultation_fee_paise)),
    default_locale: c.default_locale,
    timezone: c.timezone,
    audit_retention_days: String(c.audit_retention_days),
  };
}

const COMMON_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Colombo', 'Asia/Singapore', 'Europe/London', 'America/New_York'];
function timeZoneOptions(current: string) {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : COMMON_ZONES;
  return [...new Set([current, ...COMMON_ZONES, ...all])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }));
}

const branchSchema = z.object({
  name: requiredText(120, 2),
  address_line: optionalText(240),
  city: optionalText(80),
  phone: optionalPhone,
  is_active: z.boolean(),
});

function BranchModal({ branch, open, onOpenChange }: { branch: Branch | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const form = useForm<z.infer<typeof branchSchema>>({ resolver: zodResolver(branchSchema) });
  useEffect(() => {
    if (open) form.reset({ name: branch?.name ?? '', address_line: branch?.address_line ?? '', city: branch?.city ?? '', phone: branch?.phone ?? '', is_active: branch?.is_active ?? true });
  }, [open, branch, form]);
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof branchSchema>) =>
      saveBranch(clinicId, { name: v.name, address_line: blankToNull(v.address_line), city: blankToNull(v.city), phone: blankToNull(v.phone), is_active: v.is_active }, branch?.id),
    onSuccess: async () => {
      notify.success(t('settings.branchSaved'));
      await queryClient.invalidateQueries({ queryKey: qk.branches(clinicId) });
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={branch ? branch.name : t('settings.addBranch')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="branch-form" loading={mutation.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="branch-form" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <FormField label={t('settings.branchName')} error={fieldError(e.name)} required>
          <Input {...form.register('name')} />
        </FormField>
        <FormField label={t('settings.address')} error={fieldError(e.address_line)}>
          <Input {...form.register('address_line')} />
        </FormField>
        <FormGrid>
          <FormField label={t('settings.city')} error={fieldError(e.city)}>
            <Input {...form.register('city')} />
          </FormField>
          <FormField label={t('settings.phone')} error={fieldError(e.phone)}>
            <Input type="tel" {...form.register('phone')} />
          </FormField>
        </FormGrid>
        <Checkbox label={t('settings.active')} disabled={branch?.is_primary} {...form.register('is_active')} />
      </form>
    </Modal>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const { clinicId, clinic } = useClinic();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const [branchModal, setBranchModal] = useState<{ open: boolean; branch: Branch | null }>({ open: false, branch: null });
  const branches = useQuery({ queryKey: qk.branches(clinicId), queryFn: () => fetchBranches(clinicId) });

  const form = useForm<ClinicFormInput, unknown, ClinicFormValues>({ resolver: zodResolver(clinicSchema), values: toForm(clinic) });
  const e = form.formState.errors;

  const mutation = useMutation({
    mutationFn: (v: ClinicFormValues) =>
      updateClinic(clinicId, {
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
        invoice_prefix: v.invoice_prefix,
        consultation_fee_paise: v.consultation_fee,
        default_locale: v.default_locale,
        timezone: v.timezone,
        audit_retention_days: v.audit_retention_days,
      }),
    onSuccess: (saved) => {
      notify.success(t('settings.saved'));
      queryClient.setQueryData(qk.clinic(clinicId), saved);
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
                      <Select options={timeZoneOptions(clinic.timezone)} {...form.register('timezone')} />
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
        <SubscriptionCard />
        <Card>
          <CardHeader
            title={t('settings.branches')}
            actions={
              <Button size="sm" variant="secondary" leftIcon={<Plus className="size-4" />} onClick={() => setBranchModal({ open: true, branch: null })}>
                {t('settings.addBranch')}
              </Button>
            }
          />
          {branches.isLoading ? (
            <SkeletonRows rows={2} />
          ) : branches.isError ? (
            <ErrorState compact onRetry={() => void branches.refetch()} />
          ) : (
            <ul className="divide-y divide-line">
              {branches.data!.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <Building2 className="size-4 shrink-0 text-forest" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{b.name}</span>
                      <span className="block truncate text-xs text-ink-muted">{[b.city, b.phone].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {b.is_primary && <Badge tone="gold">{t('settings.primary')}</Badge>}
                    {!b.is_active && <Badge>{t('settings.inactive')}</Badge>}
                    <IconButton size="sm" label={`${t('common.edit')} ${b.name}`} icon={<Pencil />} onClick={() => setBranchModal({ open: true, branch: b })} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        </div>
      </div>
      <div className="mt-6">
        <ExamFieldsCard />
      </div>
      <BranchModal open={branchModal.open} branch={branchModal.branch} onOpenChange={(o) => setBranchModal((s) => ({ ...s, open: o }))} />
    </>
  );
}
