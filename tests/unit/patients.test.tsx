import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientFormDrawer } from '@/features/patients/PatientFormDrawer';
import { PatientsPage } from '@/features/patients/PatientsPage';
import { DOCTOR_PERMISSIONS, renderRoute } from './render';

const USER_ID = '00000000-0000-4000-8000-0000000000aa';
vi.mock('@/features/auth/AuthProvider', () => ({ useCurrentUser: () => ({ id: '00000000-0000-4000-8000-0000000000aa', email: 'dr@example.test', user_metadata: { full_name: 'Dr. Test' } }) }));
vi.mock('@/services/clinic', () => ({ fetchDoctors: vi.fn().mockResolvedValue([{ user_id: '00000000-0000-4000-8000-0000000000aa', full_name: 'Dr. Test' }]) }));

const patients = vi.hoisted(() => ({ listPatients: vi.fn(), createPatient: vi.fn(), updatePatient: vi.fn() }));
vi.mock('@/services/patients', () => patients);

beforeEach(() => vi.clearAllMocks());

describe('patient registration', () => {
  it('validates required and malformed fields before calling the server', async () => {
    renderRoute(<PatientFormDrawer open onOpenChange={() => undefined} />);
    await userEvent.type(await screen.findByLabelText(/Mobile number/), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid phone number.')).toBeInTheDocument();
    expect(patients.createPatient).not.toHaveBeenCalled();
  });

  it('submits trimmed values, blanks as null, and self-assigns a doctor', async () => {
    patients.createPatient.mockResolvedValue({ id: 'p1', first_name: 'Asha' });
    const saved = vi.fn();
    renderRoute(<PatientFormDrawer open onOpenChange={() => undefined} onSaved={saved} />, { permissions: DOCTOR_PERMISSIONS, roles: ['doctor'] });
    await userEvent.type(await screen.findByLabelText(/First name/), '  Asha  ');
    await userEvent.type(screen.getByLabelText(/Mobile number/), '+91 98220 10001');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patients.createPatient).toHaveBeenCalledTimes(1));
    const [, input] = patients.createPatient.mock.calls[0]!;
    expect(input).toMatchObject({ first_name: 'Asha', phone: '+91 98220 10001', email: null, assigned_doctor_id: USER_ID, status: 'active' });
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });
});

describe('patient list states', () => {
  it('shows a loading state, then rows', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    patients.listPatients.mockReturnValue(new Promise((r) => (resolve = r)));
    renderRoute(<PatientsPage />, { path: '/patients', url: '/patients' });
    expect(await screen.findByRole('status', { name: 'Loading…' })).toBeInTheDocument();
    resolve({
      rows: [{ id: 'p1', patient_code: 'P-000001', first_name: 'Sunita', last_name: 'Pawar', gender: 'female', date_of_birth: '1978-04-12', approx_age_years: null, phone: '+91 98220 10001', city: 'Pune', prakriti: null, assigned_doctor_id: null, status: 'active', created_at: '2026-10-01T05:00:00Z' }],
      total: 1,
    });
    expect((await screen.findAllByText('Sunita Pawar')).length).toBeGreaterThan(0);
    // Phone numbers are masked in lists.
    expect(screen.getAllByText('••••• 0001').length).toBeGreaterThan(0);
    expect(screen.queryByText('+91 98220 10001')).not.toBeInTheDocument();
  });

  it('shows the empty state with a registration action', async () => {
    patients.listPatients.mockResolvedValue({ rows: [], total: 0 });
    renderRoute(<PatientsPage />, { path: '/patients', url: '/patients' });
    expect(await screen.findByText('No patients yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Register patient' }).length).toBeGreaterThan(0);
  });

  it('shows a safe error state with retry', async () => {
    patients.listPatients.mockRejectedValue({ code: '23505', message: 'duplicate key (phone)=(+91 98220 10001)' });
    renderRoute(<PatientsPage />, { path: '/patients', url: '/patients' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).not.toHaveTextContent('98220');
    patients.listPatients.mockResolvedValue({ rows: [], total: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No patients yet')).toBeInTheDocument();
  });
});
