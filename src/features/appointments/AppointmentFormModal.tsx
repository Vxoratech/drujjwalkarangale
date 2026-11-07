import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { DateInput, Input, Select, Textarea } from '@/components/ui/Input';
import { useAccess } from '@/features/access/AccessProvider';
import { PatientPicker } from '@/features/patients/PatientPicker';
import { isoToIstParts, istDateTimeToISO, todayISO } from '@/lib/formatters';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { createAppointment, rescheduleAppointment } from '@/services/appointments';
import { APPOINTMENT_SOURCES, APPOINTMENT_TYPES, type AppointmentWithPatient, type UUID } from '@/types/domain';

const DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120] as const;

export const appointmentSchema = z.object({
  patient_id: z.string().uuid({ message: 'required' }),
  branch_id: z.string().uuid({ message: 'required' }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.coerce.number().int().min(5).max(480),
  type: z.enum(APPOINTMENT_TYPES),
  source: z.enum(APPOINTMENT_SOURCES),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type AppointmentFormValues = z.infer<typeof appointmentSchema>;

export interface AppointmentFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment?: AppointmentWithPatient | null;
  defaultDate?: string;
  defaultPatientId?: UUID | null;
}

export function AppointmentFormModal({ open, onOpenChange, appointment, defaultDate, defaultPatientId }: AppointmentFormModalProps) {
  const { t } = useI18n();
  const { settings, branches, defaultBranchId } = useAccess();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();

  const form = useForm<AppointmentFormValues>({ resolver: zodResolver(appointmentSchema) });
  const e = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    if (appointment) {
      const start = isoToIstParts(appointment.starts_at);
      const minutes = Math.round((new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()) / 60000);
      form.reset({
        patient_id: appointment.patient_id,
        date: start.date,
        time: start.time,
        duration: minutes,
        type: appointment.type,
        source: appointment.source,
        branch_id: appointment.branch_id,
        reason: appointment.reason ?? '',
        notes: appointment.notes ?? '',
      });
    } else {
      form.reset({
        patient_id: defaultPatientId ?? '',
        date: defaultDate ?? todayISO(),
        time: '10:00',
        duration: settings.preferences.default_appointment_minutes ?? 30,
        branch_id: defaultBranchId ?? '',
        type: 'new_visit',
        source: 'phone',
        reason: '',
        notes: '',
      });
    }
  }, [open, appointment, defaultDate, defaultPatientId, form, settings.preferences.default_appointment_minutes, defaultBranchId]);

  const mutation = useMutation({
    mutationFn: (v: AppointmentFormValues) => {
      const starts_at = istDateTimeToISO(v.date, v.time);
      const ends_at = new Date(new Date(starts_at).getTime() + v.duration * 60000).toISOString();
      const payload = { branch_id: v.branch_id, starts_at, ends_at, type: v.type, reason: v.reason || null, notes: v.notes || null };
      return appointment
        ? rescheduleAppointment(appointment.id, payload)
        : createAppointment({ ...payload, source: v.source, patient_id: v.patient_id });
    },
    onSuccess: async () => {
      notify.success(appointment ? t('appointments.updated') : t('appointments.booked'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
        queryClient.invalidateQueries({ queryKey: ['appointment'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      onOpenChange(false);
    },
    onError: (err) => notify.error(err),
  });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}
      title={appointment ? t('appointments.reschedule') : t('appointments.book')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="appointment-form" loading={mutation.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="appointment-form" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <FormField label={t('appointments.patient')} error={e.patient_id ? t('validation.required') : undefined} required>
          <Controller control={form.control} name="patient_id" render={({ field }) => <PatientPicker value={field.value || null} onChange={(id) => field.onChange(id ?? '')} disabled={Boolean(appointment)} />} />
        </FormField>
        <FormField label={t('appointments.branch')} hint={t('appointments.branchHint')} error={e.branch_id ? t('validation.required') : undefined} required>
          <Select placeholder="—" options={branches.map((b) => ({ value: b.id, label: b.name }))} {...form.register('branch_id')} />
        </FormField>
        <FormGrid cols={3}>
          <FormField label={t('appointments.date')} error={fieldError(e.date)} required>
            <DateInput {...form.register('date')} />
          </FormField>
          <FormField label={t('appointments.time')} error={fieldError(e.time)} required>
            <Input type="time" step={300} {...form.register('time')} />
          </FormField>
          <FormField label={t('appointments.duration')} required>
            <Select options={DURATIONS.map((d) => ({ value: String(d), label: t('appointments.minutes', { count: d }) }))} {...form.register('duration')} />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label={t('appointments.type')}>
            <Select options={APPOINTMENT_TYPES.map((v) => ({ value: v, label: t(`appointmentType.${v}`) }))} {...form.register('type')} />
          </FormField>
          <FormField label={t('appointments.source')}>
            <Select disabled={Boolean(appointment)} options={APPOINTMENT_SOURCES.map((v) => ({ value: v, label: t(`appointmentSource.${v}`) }))} {...form.register('source')} />
          </FormField>
        </FormGrid>
        <FormField label={t('appointments.reason')} error={fieldError(e.reason)}>
          <Textarea rows={2} {...form.register('reason')} />
        </FormField>
        <FormField label={t('appointments.notes')} error={fieldError(e.notes)}>
          <Textarea rows={2} {...form.register('notes')} />
        </FormField>
      </form>
    </Modal>
  );
}
