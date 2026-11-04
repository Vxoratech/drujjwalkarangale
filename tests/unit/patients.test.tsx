import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientFormDrawer } from '@/features/patients/PatientFormDrawer';
import { PatientsPage } from '@/features/patients/PatientsPage';
import { RECEPTIONIST_PERMISSIONS, renderRoute } from './render';

vi.mock('@/features/auth/AuthProvider', () => ({ useCurrentUser: () => ({ id: '00000000-0000-4000-8000-0000000000aa', email: 'dr@example.test', user_metadata: { full_name: 'Dr. Test' } }) }));

const patients = vi.hoisted(() => ({ listPatients: vi.fn(), registerPatient: vi.fn(), updatePatient: vi.fn(), findPossibleDuplicates: vi.fn(), DUPLICATE_REVIEW_REQUIRED: 'P0003' }));
vi.mock('@/services/patients', () => patients);

beforeEach(() => vi.clearAllMocks());

describe('patient registration', () => {
  it('validates required and malformed fields before calling the server', async () => {
    renderRoute(<PatientFormDrawer open onOpenChange={() => undefined} />);
    await userEvent.type(await screen.findByLabelText(/Mobile number/), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid phone number.')).toBeInTheDocument();
    expect(patients.findPossibleDuplicates).not.toHaveBeenCalled();
    expect(patients.registerPatient).not.toHaveBeenCalled();
  });

  it('checks for duplicates, then registers trimmed values at the current branch', async () => {
    patients.findPossibleDuplicates.mockResolvedValue([]);
    patients.registerPatient.mockResolvedValue({ id: 'p1', first_name: 'Asha' });
    const saved = vi.fn();
    renderRoute(<PatientFormDrawer open onOpenChange={() => undefined} onSaved={saved} />, { permissions: RECEPTIONIST_PERMISSIONS, account: 'staff' });
    await userEvent.type(await screen.findByLabelText(/First name/), '  Asha  ');
    await userEvent.type(screen.getByLabelText(/Mobile number/), '+91 98220 10001');
    await userEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    await waitFor(() => expect(patients.registerPatient).toHaveBeenCalledTimes(1));
    const [input, branch, reviewed] = patients.registerPatient.mock.calls[0]!;
    expect(input).toMatchObject({ first_name: 'Asha', phone: '+91 98220 10001', email: null, status: 'active' });
    expect(input).not.toHaveProperty('allergies');
    expect(branch).toBe('b-main');
    expect(reviewed).toBe(false);
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });

  it('shows likely duplicates and registers only after the user confirms it is someone else', async () => {
    patients.findPossibleDuplicates.mockResolvedValue([
      { patient_id: 'p9', patient_code: 'P-000009', first_name: 'Asha', last_name: 'Patil', phone: '+91 98220 10001', date_of_birth: null, registered_branch: 'Main Clinic', match_reasons: ['phone', 'name'], score: 0.9 },
    ]);
    patients.registerPatient.mockResolvedValue({ id: 'p2', first_name: 'Asha' });
    renderRoute(<PatientFormDrawer open onOpenChange={() => undefined} />, { permissions: RECEPTIONIST_PERMISSIONS, account: 'staff' });
    await userEvent.type(await screen.findByLabelText(/First name/), 'Asha');
    await userEvent.type(screen.getByLabelText(/Mobile number/), '+91 98220 10001');
    await userEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByText('1 similar record(s) found')).toBeInTheDocument();
    expect(screen.getByText('Same phone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open existing' })).toBeInTheDocument();
    expect(patients.registerPatient).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Register as new patient' }));
    await waitFor(() => expect(patients.registerPatient).toHaveBeenCalledTimes(1));
    expect(patients.registerPatient.mock.calls[0]![2]).toBe(true);
  });

  it('locks identity fields for staff who may edit contact details only', async () => {
    const patient = { id: 'p1', patient_code: 'P-000001', first_name: 'Asha', last_name: 'Patil', gender: 'female', status: 'active', preferred_locale: 'en' } as never;
    renderRoute(<PatientFormDrawer open onOpenChange={() => undefined} patient={patient} />, { permissions: RECEPTIONIST_PERMISSIONS, account: 'staff' });
    expect(await screen.findByLabelText(/First name/)).toBeDisabled();
    expect(screen.getByLabelText(/Mobile number/)).toBeEnabled();
  });
});

describe('patient list states', () => {
  it('shows a loading state, then rows', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    patients.listPatients.mockReturnValue(new Promise((r) => (resolve = r)));
    renderRoute(<PatientsPage />, { path: '/patients', url: '/patients' });
    expect(await screen.findByRole('status', { name: 'Loading…' })).toBeInTheDocument();
    resolve({
      rows: [{ id: 'p1', patient_code: 'P-000001', first_name: 'Sunita', last_name: 'Pawar', gender: 'female', date_of_birth: '1978-04-12', approx_age_years: null, phone: '+91 98220 10001', city: 'Pune', registered_branch_id: 'b-main', status: 'active', created_at: '2026-10-01T05:00:00Z' }],
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
