import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, FlaskConical, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDate } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { listInvestigations, orderInvestigation, updateInvestigation } from '@/services/clinical';
import { listDocuments } from '@/services/documents';
import { UploadDocumentDialog, useOpenDocument } from '@/features/documents/DocumentsPanel';
import type { Investigation, InvestigationCategory, InvestigationStatus, UUID } from '@/types/domain';

const orderSchema = z.object({
  test_name: z.string().trim().min(2).max(160),
  category: z.enum(['laboratory', 'imaging', 'other']),
  instructions: z.string().trim().max(1000).optional().or(z.literal('')),
});

const resultSchema = z.object({
  status: z.enum(['ordered', 'sample_collected', 'resulted', 'cancelled']),
  result_summary: z.string().trim().max(5000).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

function OrderDialog({ open, onOpenChange, patientId, consultationId }: { open: boolean; onOpenChange: (o: boolean) => void; patientId: UUID; consultationId?: UUID | null }) {
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const form = useForm<z.infer<typeof orderSchema>>({ resolver: zodResolver(orderSchema), defaultValues: { test_name: '', category: 'laboratory', instructions: '' } });

  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof orderSchema>) =>
      orderInvestigation(clinicId, {
        patient_id: patientId,
        consultation_id: consultationId ?? null,
        ordered_by: user.id,
        test_name: v.test_name,
        category: v.category as InvestigationCategory,
        instructions: v.instructions || null,
      }),
    onSuccess: async () => {
      notify.success(t('investigations.ordered'));
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'investigations'] });
      form.reset();
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('investigations.order')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="order-investigation" loading={mutation.isPending}>
            {t('investigations.order')}
          </Button>
        </>
      }
    >
      <form id="order-investigation" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <FormField label={t('investigations.testName')} error={fieldError(form.formState.errors.test_name)} required>
          <Input placeholder={t('investigations.testPlaceholder')} {...form.register('test_name')} />
        </FormField>
        <FormField label={t('investigations.category')}>
          <Select options={(['laboratory', 'imaging', 'other'] as const).map((c) => ({ value: c, label: t(`investigationCategory.${c}`) }))} {...form.register('category')} />
        </FormField>
        <FormField label={t('investigations.instructions')} error={fieldError(form.formState.errors.instructions)}>
          <Textarea rows={2} {...form.register('instructions')} />
        </FormField>
      </form>
    </Modal>
  );
}

function ResultDialog({ investigation, onOpenChange }: { investigation: Investigation | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof resultSchema>>({
    resolver: zodResolver(resultSchema),
    values: { status: investigation?.status ?? 'resulted', result_summary: investigation?.result_summary ?? '', notes: investigation?.notes ?? '' },
  });

  const mutation = useMutation({
    mutationFn: async (v: z.infer<typeof resultSchema>) => {
      if (!investigation) return;
      await updateInvestigation(clinicId, investigation.id, {
        status: v.status as InvestigationStatus,
        result_summary: v.result_summary || null,
        notes: v.notes || null,
      });
    },
    onSuccess: async () => {
      notify.success(t('investigations.updated'));
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'investigations'] });
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });

  return (
    <Modal
      open={Boolean(investigation)}
      onOpenChange={onOpenChange}
      title={investigation ? `${t('investigations.recordResult')} — ${investigation.test_name}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="investigation-result" loading={mutation.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="investigation-result" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <FormField label={t('investigations.status')}>
          <Select options={(['ordered', 'sample_collected', 'resulted', 'cancelled'] as const).map((s) => ({ value: s, label: t(`investigationStatus.${s}`) }))} {...form.register('status')} />
        </FormField>
        <FormField label={t('investigations.result')}>
          <Textarea rows={4} {...form.register('result_summary')} />
        </FormField>
        <FormField label={t('investigations.notes')}>
          <Textarea rows={2} {...form.register('notes')} />
        </FormField>
      </form>
    </Modal>
  );
}

export function InvestigationsPanel({ patientId, consultationId, canWrite }: { patientId: UUID; consultationId?: UUID | null; canWrite: boolean }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const [ordering, setOrdering] = useState(false);
  const [editing, setEditing] = useState<Investigation | null>(null);
  const [attaching, setAttaching] = useState<Investigation | null>(null);
  const openDocument = useOpenDocument();
  const query = useQuery({ queryKey: qk.investigations(clinicId, { patientId }), queryFn: () => listInvestigations(clinicId, { patientId }) });
  const docs = useQuery({ queryKey: [clinicId, 'documents', patientId], queryFn: () => listDocuments(clinicId, { patientId }) });
  const docsFor = (id: string) => (docs.data ?? []).filter((d) => d.investigation_id === id);

  return (
    <div>
      {canWrite && (
        <div className="mb-4 flex justify-end">
          <Button variant="secondary" leftIcon={<Plus className="size-4" />} onClick={() => setOrdering(true)}>
            {t('investigations.order')}
          </Button>
        </div>
      )}
      {query.isLoading ? (
        <SkeletonRows rows={3} />
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} />
      ) : query.data!.length === 0 ? (
        <EmptyState compact icon={<FlaskConical />} title={t('investigations.emptyTitle')} body={t('investigations.emptyBody')} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {query.data!.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{inv.test_name}</p>
                <p className="tabular text-xs text-ink-muted">
                  {t(`investigationCategory.${inv.category}`)} · {t('investigations.orderedOn')} {formatDate(inv.ordered_at)}
                  {inv.resulted_at && ` · ${t('investigations.resultedOn')} ${formatDate(inv.resulted_at)}`}
                </p>
                {inv.result_summary && <p className="mt-1 whitespace-pre-line text-sm text-ink">{inv.result_summary}</p>}
                {inv.notes && <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{inv.notes}</p>}
                {docsFor(inv.id).map((d) => (
                  <button key={d.id} type="button" className="mr-3 mt-1 inline-flex items-center gap-1 text-sm font-medium text-forest hover:underline" onClick={() => void openDocument(d)}>
                    <FileText className="size-4" aria-hidden /> {d.title}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={inv.status} label={t(`investigationStatus.${inv.status}`)} />
                {canWrite && inv.status !== 'cancelled' && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setAttaching(inv)}>
                      {t('investigations.attachReport')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(inv)}>
                      {t('investigations.recordResult')}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite && <OrderDialog open={ordering} onOpenChange={setOrdering} patientId={patientId} consultationId={consultationId} />}
      <ResultDialog investigation={editing} onOpenChange={(o) => !o && setEditing(null)} />
      {attaching && (
        <UploadDocumentDialog
          open
          onOpenChange={(o) => !o && setAttaching(null)}
          patientId={patientId}
          investigationId={attaching.id}
          consultationId={attaching.consultation_id}
          defaultCategory={attaching.category === 'imaging' ? 'imaging' : 'lab_report'}
          defaultTitle={attaching.test_name}
        />
      )}
    </div>
  );
}
