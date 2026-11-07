import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/layouts/AppShell';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { AccessContextForTests } from '@/features/access/AccessProvider';
import type { Permission } from '@/lib/permissions/permissions';
import { I18nProvider } from '@/locales/i18n';
import type { AccountType } from '@/types/domain';
import { accessContext, ADMIN_PERMISSIONS, DOCTOR_PERMISSIONS, RECEPTIONIST_PERMISSIONS } from './render';

vi.mock('@/features/auth/AuthProvider', () => ({
  useCurrentUser: () => ({ id: 'u1', email: 'user@demo.vaidyora.test', user_metadata: {} }),
}));
vi.mock('@/services/notifications', () => ({ listNotifications: vi.fn().mockResolvedValue([]), markNotificationsRead: vi.fn() }));

function renderShell(permissions: Permission[], account: AccountType, branches?: Parameters<typeof accessContext>[2]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider defaultLocale="en">
        <TooltipProvider>
          <AccessContextForTests.Provider value={accessContext(permissions, account, branches)}>
            <MemoryRouter>
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<p>Home</p>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </AccessContextForTests.Provider>
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return within(screen.getAllByRole('navigation', { name: 'Main' })[0]!);
}

describe('AppShell navigation', () => {
  it('gives the admin the full administration menu', () => {
    const nav = renderShell(ADMIN_PERMISSIONS, 'admin');
    for (const label of [
      'Overview', 'Patients', 'Appointments', 'Consultations', 'Prescriptions', 'Investigations', 'Billing',
      'Reports', 'Branch Management', 'Staff Management', 'Roles & Permissions', 'Audit Log', 'Clinic Settings',
    ]) {
      expect(nav.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('gives the doctor a clinical menu with staff and branch administration', () => {
    const nav = renderShell(DOCTOR_PERMISSIONS, 'primary_doctor');
    for (const label of [
      'Doctor Dashboard', "Today's Appointments", 'Patients', 'Consultations', 'Ayurvedic Examinations', 'Prescriptions',
      'Investigations', 'Follow-ups', 'Clinical Reports', 'My Profile', 'Branch Management', 'Staff Management',
    ]) {
      expect(nav.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(nav.queryByRole('link', { name: 'Clinic Settings' })).not.toBeInTheDocument();
  });

  it('builds a receptionist menu from effective permissions only', () => {
    const nav = renderShell(RECEPTIONIST_PERMISSIONS, 'staff', [{ id: 'b-main', code: 'MAIN', name: 'Main Clinic', is_primary: true }]);
    for (const label of ['Dashboard', 'Appointments', 'Patients', 'Follow-ups', 'Reports']) {
      expect(nav.getByRole('link', { name: label })).toBeInTheDocument();
    }
    for (const label of ['Consultations', 'Prescriptions', 'Billing', 'Staff Management', 'Audit Log', 'Clinic Settings', 'Investigations']) {
      expect(nav.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });

  it('shows the branch filter only with several branches', () => {
    renderShell(ADMIN_PERMISSIONS, 'admin');
    expect(screen.getByRole('combobox', { name: 'Branch' })).toHaveDisplayValue('All branches');
  });

  it('provides a skip link and the organization name', () => {
    renderShell(DOCTOR_PERMISSIONS, 'primary_doctor');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByText('Test Ayurvedic Clinic')).toBeInTheDocument();
    expect(screen.getByText('Primary doctor')).toBeInTheDocument();
  });
});
