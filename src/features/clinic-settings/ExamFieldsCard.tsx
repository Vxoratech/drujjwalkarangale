import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Dialog';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Input';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { listExamFields, saveExamField } from '@/services/clinical';
import type { ExamFieldDefinition } from '@/types/domain';

const TYPES = ['text', 'number', 'select', 'boolean'] as const;

export const examFieldSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, 'slugFormat'),
    label_en: z.string().trim().min(1).max(80),
    label_mr: z.string().trim().max(80).optional().or(z.literal('')),
    field_type: z.enum(TYPES),
    options: z.string().optional(),
    unit: z.string().trim().max(20).optional().or(z.literal('')),
    position: z.union([z.string(), z.number()]).pipe(z.coerce.number().int().min(0).max(999)),
    is_active: z.boolean(),
  })
  .transform((v) => ({ ...v, optionList: (v.options ?? '').split('\n').map((o) => o.trim()).filter(Boolean) }))
  .refine((v) => v.field_type !== 'select' || (v.optionList.length >= 1 && v.optionList.length <= 30), { path: ['options'], message: 'range:1:30' });

type Input_ = z.input<typeof examFieldSchema>;
type Output = z.output<typeof examFieldSchema>;

function FieldModal({ field, open, onOpenChange }: { field: ExamFieldDefinition | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const form = useForm<Input_, unknown, Output>({ resolver: zodResolver(examFieldSchema) });
  const type = useWatch({ control: form.control, name: 'field_type' });
  useEffect(() => {
    if (open)
      form.reset({
        key: field?.key ?? '',
        label_en: field?.label_en ?? '',
        label_mr: field?.label_mr ?? '',
        field_type: field?.field_type ?? 'text',
        options: (field?.options ?? []).join('\n'),
        unit: field?.unit ?? '',
        position: String(field?.position ?? 0),
        is_active: field?.is_active ?? true,
      });
  }, [open, field, form]);
  const mutation = useMutation({
    mutationFn: (v: Output) =>
      saveExamField(
        clinicId,
        {
          key: v.key,
          label_en: v.label_en,
          label_mr: v.label_mr || null,
          field_type: v.field_type,
          options: v.field_type === 'select' ? v.optionList : null,
          unit: v.unit || null,
          position: v.position,
          is_active: v.is_active,
        },
        field?.id,
      ),
    onSuccess: async () => {
      notify.success(t('settings.fieldSaved'));
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'exam-fields'] });
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={field ? field.label_en : t('settings.addExamField')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="exam-field-form" loading={mutation.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="exam-field-form" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <FormGrid>
          <FormField label={t('settings.fieldLabelEn')} error={fieldError(e.label_en)} required>
            <Input {...form.register('label_en')} />
          </FormField>
          <FormField label={t('settings.fieldLabelMr')} error={fieldError(e.label_mr)}>
            <Input lang="mr" {...form.register('label_mr')} />
          </FormField>
          <FormField label={t('settings.fieldKey')} error={fieldError(e.key)} required>
            <Input className="font-mono" disabled={Boolean(field)} {...form.register('key')} />
          </FormField>
          <FormField label={t('settings.fieldType')}>
            <Select disabled={Boolean(field)} options={TYPES.map((v) => ({ value: v, label: t(`fieldType.${v}`) }))} {...form.register('field_type')} />
          </FormField>
          <FormField label={t('settings.fieldUnit')} error={fieldError(e.unit)}>
            <Input {...form.register('unit')} />
          </FormField>
          <FormField label="#" error={fieldError(e.position)}>
            <Input inputMode="numeric" className="tabular" {...form.register('position')} />
          </FormField>
        </FormGrid>
        {type === 'select' && (
          <FormField label={t('settings.fieldOptions')} error={fieldError(e.options)} required>
            <Textarea rows={4} {...form.register('options')} />
          </FormField>
        )}
        <Checkbox label={t('settings.active')} {...form.register('is_active')} />
      </form>
    </Modal>
  );
}

export function ExamFieldsCard() {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const [modal, setModal] = useState<{ open: boolean; field: ExamFieldDefinition | null }>({ open: false, field: null });
  const query = useQuery({ queryKey: [clinicId, 'exam-fields', 'all'], queryFn: () => listExamFields(clinicId, { includeInactive: true }) });
  return (
    <Card>
      <CardHeader
        title={t('settings.examFields')}
        description={t('settings.examFieldsHint')}
        actions={
          <Button size="sm" variant="secondary" leftIcon={<Plus className="size-4" />} onClick={() => setModal({ open: true, field: null })}>
            {t('settings.addExamField')}
          </Button>
        }
      />
      {query.isLoading ? (
        <SkeletonRows rows={2} />
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} />
      ) : query.data!.length === 0 ? (
        <CardBody>
          <p className="text-sm text-ink-muted">{t('settings.noExamFields')}</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-line">
          {query.data!.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {f.label_en}
                  {f.label_mr && <span className="ml-2 text-ink-muted">{f.label_mr}</span>}
                </span>
                <span className="block font-mono text-xs text-ink-muted">{f.key}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge>{t(`fieldType.${f.field_type}`)}</Badge>
                {!f.is_active && <Badge tone="warning">{t('settings.inactive')}</Badge>}
                <IconButton size="sm" label={`${t('common.edit')} ${f.label_en}`} icon={<Pencil />} onClick={() => setModal({ open: true, field: f })} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <FieldModal open={modal.open} field={modal.field} onOpenChange={(o) => setModal((m) => ({ ...m, open: o }))} />
    </Card>
  );
}
