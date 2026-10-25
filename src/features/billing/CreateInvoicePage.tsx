import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { PatientPicker } from '@/features/patients/PatientPicker';
import { formatINR, paiseToRupees, rupeesToPaise } from '@/lib/formatters';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { createInvoice, previewTotals } from '@/services/billing';
import { INVOICE_ITEM_TYPES } from '@/types/domain';
import { invoiceSchema, type InvoiceFormInput, type InvoiceFormValues } from './invoiceSchema';

export function CreateInvoicePage() {
  const { t } = useI18n();
  const { clinicId, clinic } = useClinic();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();

  const form = useForm<InvoiceFormInput, unknown, InvoiceFormValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      patient_id: search.get('patient') ?? '',
      items: [{ description: 'Consultation', item_type: 'consultation', quantity: '1', unit_price: clinic.consultation_fee_paise ? String(paiseToRupees(clinic.consultation_fee_paise)) : '', tax_rate: '0' }],
      discount: '',
      notes: '',
    },
  });
  const lines = useFieldArray({ control: form.control, name: 'items' });
  const watched = useWatch({ control: form.control, name: ['items', 'discount'] });
  const e = form.formState.errors;

  const totals = previewTotals(
    (watched[0] ?? []).map((i) => ({ quantity: Number(i.quantity), unit_price_paise: rupeesToPaise(i.unit_price ?? ''), tax_rate: Number(i.tax_rate) })),
    watched[1] === '' || watched[1] === undefined ? 0 : rupeesToPaise(watched[1]),
  );

  const mutation = useMutation({
    mutationFn: (v: InvoiceFormValues) =>
      createInvoice(clinicId, {
        patientId: v.patient_id,
        discountPaise: v.discount,
        notes: v.notes || null,
        appointmentId: search.get('appointment'),
        items: v.items.map((i) => ({ description: i.description, item_type: i.item_type, quantity: i.quantity, unit_price_paise: i.unit_price, tax_rate: i.tax_rate })),
      }),
    onSuccess: async (invoice) => {
      notify.success(t('billing.created'));
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'invoices'] });
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'dashboard'] });
      navigate(`/billing/${invoice.id}`, { replace: true });
    },
    onError: (err) => notify.error(err),
  });

  return (
    <>
      <PageHeader breadcrumbs={[{ label: t('nav.billing'), to: '/billing' }, { label: t('billing.newInvoice') }]} title={t('billing.newInvoice')} />
      <form noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <fieldset disabled={mutation.isPending} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <Card>
              <CardBody>
                <FormField label={t('billing.patient')} error={e.patient_id ? t('validation.required') : undefined} required>
                  <Controller control={form.control} name="patient_id" render={({ field }) => <PatientPicker value={field.value || null} onChange={(id) => field.onChange(id ?? '')} />} />
                </FormField>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('billing.items')} />
              <CardBody className="space-y-3">
                {lines.fields.map((field, index) => {
                  const le = e.items?.[index];
                  return (
                    <div key={field.id} className="grid grid-cols-2 gap-3 rounded-lg border border-line p-3 sm:grid-cols-12 sm:items-start sm:border-0 sm:p-0">
                      <FormField label={t('billing.description')} error={fieldError(le?.description)} required className="col-span-2 sm:col-span-4" hideLabel={index > 0}>
                        <Input {...form.register(`items.${index}.description`)} />
                      </FormField>
                      <FormField label={t('billing.itemType')} className="col-span-2 sm:col-span-2" hideLabel={index > 0}>
                        <Select options={INVOICE_ITEM_TYPES.map((v) => ({ value: v, label: t(`invoiceItemType.${v}`) }))} {...form.register(`items.${index}.item_type`)} />
                      </FormField>
                      <FormField label={t('billing.quantity')} error={fieldError(le?.quantity)} className="sm:col-span-1" hideLabel={index > 0}>
                        <Input inputMode="decimal" className="tabular" {...form.register(`items.${index}.quantity`)} />
                      </FormField>
                      <FormField label={t('billing.unitPrice')} error={fieldError(le?.unit_price)} required className="sm:col-span-2" hideLabel={index > 0}>
                        <Input inputMode="decimal" className="tabular" {...form.register(`items.${index}.unit_price`)} />
                      </FormField>
                      <FormField label={t('billing.taxRate')} error={fieldError(le?.tax_rate)} className="sm:col-span-1" hideLabel={index > 0}>
                        <Select options={['0', '5', '12', '18', '28'].map((r) => ({ value: r, label: `${r}%` }))} {...form.register(`items.${index}.tax_rate`)} />
                      </FormField>
                      <div className={`col-span-2 flex items-center justify-between gap-2 sm:col-span-2 sm:justify-end ${index === 0 ? 'sm:pt-7' : ''}`}>
                        <span className="tabular text-sm font-medium">
                          {formatINR(Math.round(Number(watched[0]?.[index]?.quantity) * rupeesToPaise(watched[0]?.[index]?.unit_price ?? '')) || 0)}
                        </span>
                        <IconButton size="sm" label={`${t('common.remove')} ${index + 1}`} icon={<Trash2 />} onClick={() => lines.remove(index)} disabled={lines.fields.length === 1} />
                      </div>
                    </div>
                  );
                })}
                <Button variant="subtle" leftIcon={<Plus className="size-4" />} onClick={() => lines.append({ description: '', item_type: 'other', quantity: '1', unit_price: '', tax_rate: '0' })}>
                  {t('billing.addItem')}
                </Button>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <FormField label={t('billing.notes')} error={fieldError(e.notes)}>
                  <Textarea rows={2} {...form.register('notes')} />
                </FormField>
              </CardBody>
            </Card>
          </div>
          <aside>
            <Card className="xl:sticky xl:top-[calc(var(--layout-header)+1.5rem)]">
              <CardHeader title={t('billing.total')} />
              <CardBody className="space-y-3">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">{t('billing.subtotal')}</dt>
                    <dd className="tabular">{formatINR(totals.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">{t('billing.tax')}</dt>
                    <dd className="tabular">{formatINR(totals.tax)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>
                      <label htmlFor="invoice-discount" className="text-ink-muted">
                        {t('billing.discount')}
                      </label>
                    </dt>
                    <dd className="w-28">
                      <Input id="invoice-discount" inputMode="decimal" className="tabular text-right" {...form.register('discount')} aria-invalid={Boolean(e.discount) || undefined} />
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-3 font-display text-lg font-semibold">
                    <dt>{t('billing.total')}</dt>
                    <dd className="tabular">{formatINR(totals.total)}</dd>
                  </div>
                </dl>
                {totals.total < 0 && <Alert tone="danger">Discount cannot exceed the invoice amount.</Alert>}
                <p className="text-xs text-ink-muted">{t('billing.estimate')}</p>
                <Button type="submit" fullWidth size="lg" loading={mutation.isPending} disabled={totals.total < 0}>
                  {t('billing.createInvoice')}
                </Button>
              </CardBody>
            </Card>
          </aside>
        </fieldset>
      </form>
    </>
  );
}
