import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, LogIn, MoreHorizontal, Stethoscope, UserX, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { Textarea } from '@/components/ui/Input';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useI18n } from '@/locales/i18n';
import { NEXT_STATUSES, setAppointmentStatus } from '@/services/appointments';
import { findConsultationForAppointment } from '@/services/clinical';
import type { AppointmentStatus, AppointmentWithPatient } from '@/types/domain';
import { AppointmentFormModal } from './AppointmentFormModal';

/** Status transitions + reschedule for one appointment, filtered by role and state machine. */
export function AppointmentActions({ appointment, variant = 'menu' }: { appointment: AppointmentWithPatient; variant?: 'menu' | 'buttons' }) {
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId, can } = useClinic();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const canManage = can('appointments.manage');
  const isOwn = appointment.doctor_id === user.id;
  const canUpdate = canManage || (isOwn && can('appointments.update_own'));
  const allowed = canUpdate ? NEXT_STATUSES[appointment.status] : [];
  const canConsult = isOwn && can('clinical.write') && ['scheduled', 'checked_in', 'in_consultation'].includes(appointment.status);

  const mutation = useMutation({
    mutationFn: ({ status, why }: { status: AppointmentStatus; why?: string }) => setAppointmentStatus(appointment.id, status, why),
    onSuccess: async (_d, vars) => {
      notify.success(vars.status === 'cancelled' ? t('appointments.cancelled') : t('appointments.updated'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [clinicId, 'appointments'] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'appointment', appointment.id] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'dashboard'] }),
      ]);
    },
    onError: (e) => notify.error(e),
  });

  async function openConsultation() {
    try {
      const existing = await findConsultationForAppointment(clinicId, appointment.id);
      navigate(existing ? `/consultations/${existing}` : `/consultations/new?appointment=${appointment.id}&patient=${appointment.patient_id}`);
    } catch (e) {
      notify.error(e);
    }
  }

  const items: { key: string; label: string; icon: ReactNode; onSelect: () => void; danger?: boolean }[] = [];
  if (canConsult) items.push({ key: 'consult', label: t('appointments.startConsultation'), icon: <Stethoscope />, onSelect: () => void openConsultation() });
  if (allowed.includes('checked_in')) items.push({ key: 'in', label: t('appointments.checkIn'), icon: <LogIn />, onSelect: () => mutation.mutate({ status: 'checked_in' }) });
  if (allowed.includes('completed') && !canConsult) items.push({ key: 'done', label: t('appointments.complete'), icon: <CheckCircle2 />, onSelect: () => mutation.mutate({ status: 'completed' }) });
  if (canManage && ['scheduled', 'checked_in'].includes(appointment.status)) items.push({ key: 'resched', label: t('appointments.reschedule'), icon: <CalendarClock />, onSelect: () => setRescheduleOpen(true) });
  if (allowed.includes('no_show')) items.push({ key: 'noshow', label: t('appointments.markNoShow'), icon: <UserX />, onSelect: () => mutation.mutate({ status: 'no_show' }) });
  if (allowed.includes('cancelled')) items.push({ key: 'cancel', label: t('appointments.cancel'), icon: <XCircle />, onSelect: () => setCancelOpen(true), danger: true });

  if (items.length === 0) return null;

  return (
    <>
      {variant === 'buttons' ? (
        <div className="flex flex-wrap gap-2">
          {items.map((i, idx) => (
            <Button key={i.key} variant={idx === 0 ? 'primary' : i.danger ? 'ghost' : 'secondary'} leftIcon={i.icon} onClick={i.onSelect} disabled={mutation.isPending} className={i.danger ? 'text-danger' : undefined}>
              {i.label}
            </Button>
          ))}
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" label={t('common.actions')} icon={<MoreHorizontal />} disabled={mutation.isPending} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {items.map((i) => (
              <DropdownMenuItem key={i.key} icon={i.icon} onSelect={i.onSelect} danger={i.danger}>
                {i.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(o) => {
          setCancelOpen(o);
          if (!o) setReason('');
        }}
        title={t('appointments.cancel')}
        body={null}
        confirmLabel={t('appointments.cancel')}
        cancelLabel={t('common.back')}
        tone="danger"
        confirmDisabled={reason.trim().length === 0}
        onConfirm={() => mutation.mutateAsync({ status: 'cancelled', why: reason })}
      >
        <FormField label={t('appointments.cancelReason')} required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </FormField>
      </ConfirmDialog>
      {canManage && <AppointmentFormModal open={rescheduleOpen} onOpenChange={setRescheduleOpen} appointment={appointment} />}
    </>
  );
}
