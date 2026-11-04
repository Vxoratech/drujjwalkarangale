import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppointmentActions } from '@/features/appointments/AppointmentActions';
import type { AppointmentStatus, AppointmentWithPatient } from '@/types/domain';
import { DOCTOR_PERMISSIONS, RECEPTIONIST_PERMISSIONS, renderRoute } from './render';

vi.mock('@/features/auth/AuthProvider', () => ({ useCurrentUser: () => ({ id: '00000000-0000-4000-8000-0000000000aa', email: 'me@example.test', user_metadata: {} }) }));
const api = vi.hoisted(() => ({ setAppointmentStatus: vi.fn() }));
vi.mock('@/services/appointments', async (orig) => ({ ...(await orig<typeof import('@/services/appointments')>()), setAppointmentStatus: api.setAppointmentStatus }));
vi.mock('@/services/clinical', () => ({ findConsultationForAppointment: vi.fn().mockResolvedValue(null) }));

beforeEach(() => vi.clearAllMocks());

const appt = (status: AppointmentStatus): AppointmentWithPatient => ({
  id: 'a1', branch_id: 'b-main', patient_id: 'p1',
  starts_at: '2026-11-10T04:30:00Z', ends_at: '2026-11-10T05:00:00Z', type: 'follow_up', status,
  reason: null, source: 'phone', notes: null, cancellation_reason: null, cancelled_at: null,
  patient: { id: 'p1', first_name: 'Sunita', last_name: 'Pawar', patient_code: 'P-000001', phone: null },
});

async function menuItems(): Promise<string[]> {
  await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
  return (await screen.findAllByRole('menuitem')).map((i) => i.textContent ?? '');
}

describe('appointment actions by role and status', () => {
  it('front desk can check in, reschedule, mark no-show or cancel a scheduled visit, but not consult', async () => {
    renderRoute(<AppointmentActions appointment={appt('scheduled')} />, { permissions: RECEPTIONIST_PERMISSIONS, account: 'staff' });
    expect(await menuItems()).toEqual(['Check in', 'Mark completed', 'Reschedule', 'Mark no-show', 'Cancel appointment']);
  });

  it('Dr. Ujjwal can start the consultation from any appointment', async () => {
    renderRoute(<AppointmentActions appointment={appt('checked_in')} />, { permissions: DOCTOR_PERMISSIONS, account: 'primary_doctor' });
    const items = await menuItems();
    expect(items[0]).toBe('Start consultation');
  });

  it('staff without appointment permissions get no actions', () => {
    renderRoute(<AppointmentActions appointment={appt('scheduled')} />, { permissions: ['billing.view', 'billing.create'], account: 'staff' });
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('cancelling needs its own permission', async () => {
    renderRoute(<AppointmentActions appointment={appt('scheduled')} />, { permissions: ['appointments.view', 'appointments.update_status'], account: 'staff' });
    const items = await menuItems();
    expect(items).toContain('Check in');
    expect(items).not.toContain('Cancel appointment');
    expect(items).not.toContain('Reschedule');
  });

  it('completed, cancelled and no-show visits are final', () => {
    for (const s of ['completed', 'cancelled', 'no_show'] as const) {
      const { unmount } = renderRoute(<AppointmentActions appointment={appt(s)} />);
      expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('cancelling requires a reason, which is sent to the server', async () => {
    api.setAppointmentStatus.mockResolvedValue({});
    renderRoute(<AppointmentActions appointment={appt('scheduled')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel appointment' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getAllByRole('button', { name: 'Cancel appointment' }).at(-1)!;
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason for cancellation/), 'Patient travelling');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(api.setAppointmentStatus).toHaveBeenCalledWith('a1', 'cancelled', 'Patient travelling'));
  });
});

describe('appointment state machine parity', () => {
  it('the UI transition table matches the database trigger', async () => {
    const { NEXT_STATUSES } = await vi.importActual<typeof import('@/services/appointments')>('@/services/appointments');
    const dir = join(import.meta.dirname, '../../supabase/migrations');
    const sql = readdirSync(dir)
      .sort()
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    // Use the most recent definition of the trigger function.
    const fn = sql.slice(sql.lastIndexOf('create or replace function private.validate_appointment_status()'));
    const caseBlock = fn.slice(fn.indexOf('v_allowed := case old.status'), fn.indexOf('end;'));
    const parsed: Record<string, string[]> = {};
    for (const m of caseBlock.matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)) {
      parsed[m[1]!] = [...m[2]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!);
    }
    for (const [from, to] of Object.entries(NEXT_STATUSES)) {
      expect(to, from).toEqual(parsed[from] ?? []);
    }
  });
});
