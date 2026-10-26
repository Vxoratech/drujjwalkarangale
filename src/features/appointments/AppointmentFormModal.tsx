import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { DateInput, Input, Select, Textarea } from '@/components/ui/Input';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { PatientPicker } from '@/features/patients/PatientPicker';
import { useDoctors } from '@/hooks/useDoctors';
import { isoToIstParts, istDateTimeToISO, todayISO } from '@/lib/formatters';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { createAppointment, rescheduleAppointment } from '@/services/appointments';
import { fetchBranches } from '@/services/clinic';
import { qk } from '@/lib/query/keys';
import { APPOINTMENT_SOURCES, APPOINTMENT_TYPES, type AppointmentWithPatient, type UUID } from '@/types/domain';

const DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120] as const;

export const appointmentSchema = z.object({
  patient_id: z.string().uuid({ message: 'required' }),
  doctor_id: z.string().uuid({ message: 'required' }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.coerce.number().int().min(5).max(480),
  type: z.enum(APPOINTMENT_TYPES),
  source: z.enum(APPOINTMENT_SOURCES),
  branch_id: z.string().uuid().optional().or(z.literal('')),
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
  defaultDoctorId?: UUID | null;
}

export function AppointmentFormModal({ open, onOpenChange, appointment, defaultDate, defaultPatientId, defaultDoctorId }: AppointmentFormModalProps) {
  const { t } = useI18n();
  const { clinicId, clinic, membership } = useClinic();
  const { doctors } = useDoctors();
  const branches = useQuery({ queryKey: qk.branches(clinicId), queryFn: () => fetchBranches(clinicId), staleTime: 5 * 60_000 });
  const activeBranches = (branches.data ?? []).filter((b) => b.is_active);
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
        doctor_id: appointment.doctor_id,
        date: start.date,
        time: start.time,
        duration: minutes,
        type: appointment.type,
        source: appointment.source,
        branch_id: appointment.branch_id ?? '',
        reason: appointment.reason ?? '',
        notes: appointment.notes ?? '',
      });
    } else {
      form.reset({
        patient_id: defaultPatientId ?? '',
        doctor_id: defaultDoctorId ?? (doctors.length === 1 ? doctors[0]!.user_id : ''),
        date: defaultDate ?? todayISO(),
        time: '10:00',
        duration: clinic.settings.default_appointment_minutes ?? 30,
        branch_id: membership.default_branch_id ?? '',
        type: 'new_visit',
        source: 'phone',
        reason: '',
        notes: '',
      });
    }
  }, [open, appointment, defaultDate, defaultPatientId, defaultDoctorId, doctors, form, clinic.settings.default_appointment_minutes, membership.default_branch_id]);

  const mutation = useMutation({
    mutationFn: (v: AppointmentFormValues) => {
      const starts_at = istDateTimeToISO(v.date, v.time);
      const ends_at = new Date(new Date(starts_at).getTime() + v.duration * 60000).toISOString();
      const payload = { doctor_id: v.doctor_id, starts_at, ends_at, type: v.type, reason: v.reason || null, notes: v.notes || null, branch_id: v.branch_id || null };
      return appointment
        ? rescheduleAppointment(clinicId, appointment.id, payload)
        : createAppointment(clinicId, { ...payload, source: v.source, patient_id: v.patient_id });
    },
    onSuccess: async () => {
      notify.success(appointment ? t('appointments.updated') : t('appointments.booked'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [clinicId, 'appointments'] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'appointment'] }),
        queryClient.invalidateQueries({ queryKey: qkDashboard(clinicId) }),
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
        <FormGrid>
          <FormField label={t('appointments.doctor')} error={e.doctor_id ? t('validation.required') : undefined} required>
            <Select placeholder="—" options={doctors.map((d) => ({ value: d.user_id, label: d.full_name }))} {...form.register('doctor_id')} />
          </FormField>
          {activeBranches.length > 1 && (
            <FormField label={t('appointments.branch')}>
              <Select placeholder="—" options={activeBranches.map((b) => ({ value: b.id, label: b.name }))} {...form.register('branch_id')} />
            </FormField>
          )}
        </FormGrid>
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

function qkDashboard(clinicId: string) {
  return [clinicId, 'dashboard'] as const;
}
