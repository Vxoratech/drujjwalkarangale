import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/layouts/AppShell';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ClinicContextForTests } from '@/features/clinic/ClinicProvider';
import type { Permission } from '@/lib/permissions/permissions';
import { I18nProvider } from '@/locales/i18n';
import { clinicContext } from './render';

vi.mock('@/features/auth/AuthProvider', () => ({
  useCurrentUser: () => ({ id: 'u1', email: 'dr.meera@demo.vaidyora.test', user_metadata: { full_name: 'Dr. Meera Joshi' } }),
}));
vi.mock('@/services/reports', () => ({ listNotifications: vi.fn().mockResolvedValue([]), markNotificationsRead: vi.fn() }));

const ADMIN: Permission[] = ['patients.read_all', 'patients.create', 'appointments.read_all', 'appointments.manage', 'billing.read', 'billing.create', 'reports.read', 'settings.manage', 'users.read', 'users.manage', 'audit.read'];
const DOCTOR: Permission[] = ['patients.read_assigned', 'patients.create', 'appointments.read_own', 'appointments.update_own', 'clinical.read_assigned', 'clinical.write'];

function renderShell(permissions: Permission[], roles: ('admin' | 'doctor')[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider defaultLocale="en">
        <TooltipProvider>
          <ClinicContextForTests.Provider value={clinicContext(permissions, roles)}>
            <MemoryRouter>
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<p>Home</p>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </ClinicContextForTests.Provider>
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return within(screen.getAllByRole('navigation', { name: 'Main' })[0]!);
}

describe('AppShell navigation', () => {
  it('shows administration modules to admins but not clinical drafts', () => {
    const nav = renderShell(ADMIN, ['admin']);
    for (const label of ['Dashboard', 'Appointments', 'Patients', 'Billing', 'Reports', 'Staff & Access', 'Clinic Settings', 'Audit Log']) {
      expect(nav.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(nav.queryByRole('link', { name: 'Consultations' })).not.toBeInTheDocument();
  });

  it('shows doctors only care modules', () => {
    const nav = renderShell(DOCTOR, ['doctor']);
    expect(nav.getByRole('link', { name: 'Consultations' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'Patients' })).toBeInTheDocument();
    for (const label of ['Billing', 'Reports', 'Staff & Access', 'Clinic Settings', 'Audit Log']) {
      expect(nav.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });

  it('provides a skip link and the clinic name', () => {
    renderShell(DOCTOR, ['doctor']);
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByText('Test Clinic')).toBeInTheDocument();
  });
});
