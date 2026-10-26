import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ClinicContextForTests, type ClinicContextValue } from '@/features/clinic/ClinicProvider';
import { satisfies, type Permission } from '@/lib/permissions/permissions';
import { I18nProvider } from '@/locales/i18n';
import type { Clinic, Membership } from '@/types/domain';

const clinic: Clinic = {
  id: 'c1', name: 'Test Clinic', legal_name: null, phone: null, email: null, address_line: null, city: 'Pune', state: null,
  pincode: null, gstin: null, registration_no: null, logo_path: null, timezone: 'Asia/Kolkata', currency: 'INR',
  default_locale: 'en', invoice_prefix: 'INV', consultation_fee_paise: 0, status: 'active', status_reason: null,
  brand_accent: null, audit_retention_days: 2920, settings: {},
};

export function clinicContext(permissions: Permission[], roles: Membership['roles'] = ['admin']): ClinicContextValue {
  const set = new Set(permissions);
  const membership: Membership = { id: 'm1', clinic_id: 'c1', user_id: 'u1', roles, status: 'active', default_branch_id: null, clinic };
  return {
    clinicId: 'c1', clinic, membership, memberships: [membership], roles, permissions: set,
    can: (r) => satisfies(set, r), isDoctor: roles.includes('doctor'), switchClinic: () => undefined,
  };
}

export function renderWithProviders(ui: ReactElement, opts: { permissions?: Permission[]; locale?: 'en' | 'mr' } & RenderOptions = {}) {
  const { permissions, locale = 'en', ...rest } = opts;
  function Wrapper({ children }: { children: ReactNode }) {
    const inner = permissions ? <ClinicContextForTests.Provider value={clinicContext(permissions)}>{children}</ClinicContextForTests.Provider> : children;
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
