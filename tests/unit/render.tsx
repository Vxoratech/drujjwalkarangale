import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { AccessContextForTests, type AccessContextValue } from '@/features/access/AccessProvider';
import { PERMISSIONS, satisfies, type Permission } from '@/lib/permissions/permissions';
import { I18nProvider } from '@/locales/i18n';
import type { AccountType, Organization, OrganizationSettings } from '@/types/domain';

const organization: Organization = {
  id: 'o1', name: 'Test Ayurvedic Clinic', legal_name: null, phone: null, email: null, address_line: null, city: 'Pune', state: null,
  pincode: null, gstin: null, registration_no: null, logo_path: null, primary_doctor_id: 'doc',
};
const settings: OrganizationSettings = {
  organization_id: 'o1', timezone: 'Asia/Kolkata', currency: 'INR', default_locale: 'en', invoice_prefix: 'INV', consultation_fee_paise: 0,
  brand_accent: null, prescription_footer: null, audit_retention_days: 2920, preferences: {},
};
export const BRANCHES = [
  { id: 'b-main', code: 'MAIN', name: 'Main Clinic', is_primary: true },
  { id: 'b-dhn', code: 'DHN', name: 'Dhanori Branch', is_primary: false },
];

const DOCTOR_ONLY: Permission[] = ['consultations.create', 'consultations.edit', 'examinations.edit', 'prescriptions.create', 'prescriptions.finalize', 'investigations.order'];

/** Permission sets matching the seeded account roles and templates (supabase/migrations/…0200). */
export const ADMIN_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => !DOCTOR_ONLY.includes(p));
export const DOCTOR_PERMISSIONS: Permission[] = PERMISSIONS.filter(
  (p) => !['settings.organization', 'billing.create', 'billing.void', 'billing.export', 'payments.record', 'payments.refund', 'payments.reconcile', 'reports.financial'].includes(p),
);
export const RECEPTIONIST_PERMISSIONS: Permission[] = [
  'patients.view_basic', 'patients.create', 'patients.edit_contact', 'consents.manage', 'appointments.view', 'appointments.create',
  'appointments.reschedule', 'appointments.cancel', 'appointments.update_status', 'follow_ups.view', 'reports.operational',
];

export function accessContext(permissions: Permission[], account: AccountType = 'admin', branches = BRANCHES): AccessContextValue {
  const set = new Set(permissions);
  const names = new Map(branches.map((b) => [b.id, b.name]));
  return {
    userId: 'u1', fullName: account === 'primary_doctor' ? 'Dr. Ujjwal Karangale' : 'Asha Admin', account,
    isDoctor: account === 'primary_doctor', isAdmin: account === 'admin', staffId: account === 'staff' ? 's1' : null,
    designation: account === 'staff' ? 'receptionist' : null, designationLabel: null,
    permissions: set, can: (r) => satisfies(set, r), allBranches: account !== 'staff', branches,
    branchFilter: null, setBranchFilter: () => undefined, defaultBranchId: branches[0]?.id ?? null,
    branchName: (id) => (id ? (names.get(id) ?? '—') : '—'), organization, settings,
  };
}

export function renderWithProviders(ui: ReactElement, opts: { permissions?: Permission[]; account?: AccountType; locale?: 'en' | 'mr' } & RenderOptions = {}) {
  const { permissions, account = 'admin', locale = 'en', ...rest } = opts;
  function Wrapper({ children }: { children: ReactNode }) {
    const inner = permissions ? <AccessContextForTests.Provider value={accessContext(permissions, account)}>{children}</AccessContextForTests.Provider> : children;
    return (
      <I18nProvider defaultLocale={locale}>
        <TooltipProvider>
          <MemoryRouter>{inner}</MemoryRouter>
        </TooltipProvider>
      </I18nProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...rest });
}

/**
 * Render a page inside a data router (so useBlocker etc. work) with a fresh
 * query client, i18n and access context.
 */
export function renderRoute(
  element: ReactElement,
  opts: { path?: string; url?: string; permissions?: Permission[]; account?: AccountType; locale?: 'en' | 'mr' } = {},
) {
  const { path = '/', url = '/', permissions = ADMIN_PERMISSIONS, account = 'admin', locale = 'en' } = opts;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path, element }, { path: '*', element: <p>elsewhere</p> }], { initialEntries: [url] });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider defaultLocale={locale}>
        <TooltipProvider>
          <AccessContextForTests.Provider value={accessContext(permissions, account)}>
            <RouterProvider router={router} />
          </AccessContextForTests.Provider>
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, router, queryClient };
}
