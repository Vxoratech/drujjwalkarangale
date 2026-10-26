import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { DateInput, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Dialog';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useDoctors } from '@/hooks/useDoctors';
import { addDaysISO, formatDate, fullName, istDateTimeToISO, todayISO } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { bookFollowUp, listFollowUps } from '@/services/clinical';
import type { FollowUp } from '@/types/domain';

const bookSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.union([z.string(), z.number()]).pipe(z.coerce.number().int().min(5).max(240)),
});

function BookDialog({ followUp, onClose }: { followUp: FollowUp; onClose: () => void }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof bookSchema>, unknown, z.output<typeof bookSchema>>({
    resolver: zodResolver(bookSchema),
    defaultValues: { date: followUp.due_date < todayISO() ? todayISO() : followUp.due_date, time: '10:00', duration: '30' },
  });
  const mutation = useMutation({
    mutationFn: (v: z.output<typeof bookSchema>) => {
      const startsAt = istDateTimeToISO(v.date, v.time);
      return bookFollowUp({ followUpId: followUp.id, startsAt, endsAt: new Date(new Date(startsAt).getTime() + v.duration * 60000).toISOString(), reason: null });
    },
    onSuccess: async () => {
      notify.success(t('followUps.booked'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [clinicId, 'follow-ups'] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'appointments'] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'dashboard'] }),
      ]);
      onClose();
    },
    onError: (e) => notify.error(e),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('appointments.bookFollowUp')}
      description={fullName(followUp.patient)}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="book-follow-up" loading={mutation.isPending}>
            {t('followUps.book')}
          </Button>
        </>
      }
    >
      <form id="book-follow-up" noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <FormGrid cols={3}>
          <FormField label={t('appointments.date')} required>
            <DateInput min={todayISO()} {...form.register('date')} />
          </FormField>
          <FormField label={t('appointments.time')} required>
            <Input type="time" step={300} {...form.register('time')} />
          </FormField>
          <FormField label={t('appointments.duration')}>
            <Select options={[15, 20, 30, 45, 60].map((d) => ({ value: String(d), label: t('appointments.minutes', { count: d }) }))} {...form.register('duration')} />
          </FormField>
        </FormGrid>
      </form>
    </Modal>
  );
}

/** Pending follow-ups due within a week. Front desk can book them; doctors see their own. */
export function FollowUpsCard() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId, can } = useClinic();
  const { names } = useDoctors();
  const [booking, setBooking] = useState<FollowUp | null>(null);
  const canBook = can('appointments.manage');
  const params = { status: 'pending' as const, dueBefore: addDaysISO(todayISO(), 7), doctorId: canBook ? undefined : user.id };
  const query = useQuery({ queryKey: [clinicId, 'follow-ups', params], queryFn: () => listFollowUps(clinicId, params) });
  const today = todayISO();

  return (
    <Card>
      <CardHeader title={t('followUps.title')} />
      {query.isLoading ? (
        <SkeletonRows rows={3} />
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} />
      ) : query.data!.length === 0 ? (
        <EmptyState compact icon={<CalendarCheck />} title={t('followUps.empty')} />
      ) : (
        <ul className="divide-y divide-line">
          {query.data!.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <PatientIdentity className="min-w-0 flex-1" name={fullName(f.patient)} code={f.patient?.patient_code} meta={names.get(f.doctor_id)} />
              <span className="tabular text-sm text-ink-muted">
                {t('followUps.due')} {formatDate(f.due_date)}
              </span>
              {f.due_date < today && <Badge tone="warning">{t('followUps.overdue')}</Badge>}
              {canBook && (
                <Button size="sm" variant="secondary" onClick={() => setBooking(f)}>
                  {t('followUps.book')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {booking && <BookDialog followUp={booking} onClose={() => setBooking(null)} />}
    </Card>
  );
}
