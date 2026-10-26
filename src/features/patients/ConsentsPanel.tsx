import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Dialog';
import { Select, Textarea } from '@/components/ui/Input';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDateTime } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { CONSENT_POLICY_VERSION, grantConsent, listConsents, withdrawConsent } from '@/services/consents';
import { CONSENT_METHODS, CONSENT_TYPES, type ConsentMethod, type ConsentType, type PatientConsent, type UUID } from '@/types/domain';

export function ConsentsPanel({ patientId }: { patientId: UUID }) {
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId, can } = useClinic();
  const queryClient = useQueryClient();
  const canManage = can('consents.manage');
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ConsentType>('treatment');
  const [method, setMethod] = useState<ConsentMethod>('written');
  const [notes, setNotes] = useState('');
  const [withdrawing, setWithdrawing] = useState<PatientConsent | null>(null);
  const query = useQuery({ queryKey: [clinicId, 'consents', patientId], queryFn: () => listConsents(clinicId, patientId) });
  const active = new Set((query.data ?? []).filter((c) => c.status === 'granted').map((c) => c.consent_type));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [clinicId, 'consents', patientId] });

  const grant = useMutation({
    mutationFn: () => grantConsent(clinicId, { patientId, type, method, notes: notes.trim() || null, recordedBy: user.id }),
    onSuccess: async () => {
      notify.success(t('patients.consentRecorded'));
      setOpen(false);
      setNotes('');
      await invalidate();
    },
    onError: (e) => notify.error(e),
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawConsent(withdrawing!.id),
    onSuccess: async () => {
      notify.success(t('patients.consentWithdrawn'));
      await invalidate();
    },
    onError: (e) => notify.error(e),
  });

  const available = CONSENT_TYPES.filter((c) => !active.has(c));

  return (
    <div>
      {canManage && available.length > 0 && (
        <div className="mb-4 flex justify-end">
          <Button
            variant="secondary"
            leftIcon={<Plus className="size-4" />}
            onClick={() => {
              setType(available[0]!);
              setOpen(true);
            }}
          >
            {t('patients.recordConsent')}
          </Button>
        </div>
      )}
      {query.isLoading ? (
        <SkeletonRows rows={2} />
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} />
      ) : query.data!.length === 0 ? (
        <EmptyState compact icon={<ShieldCheck />} title={t('patients.noConsents')} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {query.data!.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium">{t(`consentType.${c.consent_type}`)}</p>
                <p className="tabular text-xs text-ink-muted">
                  {t(`consentMethod.${c.method}`)} · {formatDateTime(c.granted_at)} · {t('patients.policyVersion', { version: c.policy_version })}
                  {c.withdrawn_at && ` · ${t('patients.withdrawn')} ${formatDateTime(c.withdrawn_at)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={c.status === 'granted' ? 'active' : 'cancelled'} label={c.status === 'granted' ? t('patients.granted') : t('patients.withdrawn')} />
                {canManage && c.status === 'granted' && (
                  <Button size="sm" variant="ghost" onClick={() => setWithdrawing(c)}>
                    {t('patients.withdraw')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('patients.recordConsent')}
        description={t('patients.policyVersion', { version: CONSENT_POLICY_VERSION })}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={grant.isPending} onClick={() => grant.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label={t('patients.consentType')} required>
            <Select value={type} onChange={(e) => setType(e.target.value as ConsentType)} options={available.map((c) => ({ value: c, label: t(`consentType.${c}`) }))} />
          </FormField>
          <FormField label={t('patients.consentMethod')} required>
            <Select value={method} onChange={(e) => setMethod(e.target.value as ConsentMethod)} options={CONSENT_METHODS.map((m) => ({ value: m, label: t(`consentMethod.${m}`) }))} />
          </FormField>
          <FormField label={t('billing.notes')}>
            <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(withdrawing)}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title={t('patients.withdraw')}
        body={t('patients.withdrawConfirm')}
        confirmLabel={t('patients.withdraw')}
        cancelLabel={t('common.back')}
        tone="danger"
        onConfirm={() => withdraw.mutateAsync()}
      />
    </div>
  );
}
