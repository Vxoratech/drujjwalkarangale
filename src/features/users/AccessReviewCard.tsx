import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { Alert } from '@/components/feedback/States';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Dialog';
import { Checkbox, Textarea } from '@/components/ui/Input';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDateTime } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { fetchProfileNames, listAccessReviews, recordAccessReview } from '@/services/clinic';

/** Review cadence the UI nudges towards (documented in docs/FEATURES.md). */
const REVIEW_INTERVAL_DAYS = 90;

export function AccessReviewCard({ memberCount }: { memberCount: number }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState(false);
  const [notes, setNotes] = useState('');
  const reviews = useQuery({ queryKey: [clinicId, 'access-reviews'], queryFn: () => listAccessReviews(clinicId) });
  const reviewerIds = [...new Set((reviews.data ?? []).map((r) => r.reviewer_id))];
  const names = useQuery({ queryKey: ['profile-names', reviewerIds], queryFn: () => fetchProfileNames(reviewerIds), enabled: reviewerIds.length > 0 });
  const last = reviews.data?.[0];
  const overdue = !last || Date.now() - Date.parse(last.reviewed_at) > REVIEW_INTERVAL_DAYS * 86_400_000;

  const record = useMutation({
    mutationFn: () => recordAccessReview(clinicId, { memberCount, changesMade: changes, notes: notes.trim() || null }),
    onSuccess: async () => {
      notify.success(t('staff.reviewRecorded'));
      setOpen(false);
      setNotes('');
      setChanges(false);
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'access-reviews'] });
    },
    onError: (e) => notify.error(e),
  });

  return (
    <Card>
      <CardHeader
        title={t('staff.accessReview')}
        description={t('staff.accessReviewHint', { days: REVIEW_INTERVAL_DAYS })}
        actions={
          <Button size="sm" variant={overdue ? 'primary' : 'secondary'} leftIcon={<ClipboardCheck className="size-4" />} onClick={() => setOpen(true)}>
            {t('staff.recordReview')}
          </Button>
        }
      />
      <CardBody className="space-y-3 text-sm">
        {overdue && <Alert tone="warning">{last ? t('staff.reviewOverdue') : t('staff.noReviewYet')}</Alert>}
        {(reviews.data ?? []).length > 0 && (
          <ul className="space-y-2">
            {reviews.data!.slice(0, 5).map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {names.data?.get(r.reviewer_id) ?? '—'} · {t('staff.membersReviewed', { count: r.member_count })}
                  {r.changes_made && ` · ${t('staff.changesMade')}`}
                  {r.notes && <span className="block text-xs text-ink-muted">{r.notes}</span>}
                </span>
                <span className="tabular text-xs text-ink-muted">{formatDateTime(r.reviewed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('staff.recordReview')}
        description={t('staff.reviewChecklist')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={record.isPending} onClick={() => record.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Checkbox label={t('staff.changesMade')} checked={changes} onChange={(e) => setChanges(e.target.checked)} />
          <FormField label={t('billing.notes')}>
            <Textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </div>
      </Modal>
    </Card>
  );
}
