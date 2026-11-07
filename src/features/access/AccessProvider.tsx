import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { qk } from '@/lib/query/keys';
import { satisfies, type Permission, type PermissionRequirement } from '@/lib/permissions/permissions';
import { setDisplayTimeZone } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { fetchMyAccess, fetchOrganization, fetchSettings, type AccessResult, type BranchRef } from '@/services/organization';
import type { AccountType, Organization, OrganizationSettings, StaffDesignation, UUID } from '@/types/domain';

const BRANCH_FILTER_KEY = 'vaidyora.branchFilter';

export interface AccessContextValue {
  userId: UUID;
  fullName: string;
  account: AccountType;
  isDoctor: boolean;
  isAdmin: boolean;
  staffId: UUID | null;
  designation: StaffDesignation | null;
  designationLabel: string | null;
  permissions: ReadonlySet<Permission>;
  can: (requirement: PermissionRequirement | undefined) => boolean;
  /** Doctor and admin act on every branch; staff on their assigned branches. */
  allBranches: boolean;
  branches: BranchRef[];
  /** Dashboard/list filter: null means all of the user's branches. */
  branchFilter: UUID | null;
  setBranchFilter: (branchId: UUID | null) => void;
  /** Branch used for new records: the filter, else the primary or first branch. */
  defaultBranchId: UUID | null;
  branchName: (id: UUID | null | undefined) => string;
  organization: Organization;
  settings: OrganizationSettings;
}

const AccessContext = createContext<AccessContextValue | null>(null);

function readStoredFilter(): string | null {
  try {
    return localStorage.getItem(BRANCH_FILTER_KEY);
  } catch {
    return null;
  }
}

export type AccessGateState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'no_access'; reason: Extract<AccessResult, { account_type: null }>['reason'] }
  | { status: 'ready'; value: AccessContextValue };

/** How often to re-check access so permission changes take effect without a reload. */
const ACCESS_REFRESH_MS = 2 * 60_000;

/**
 * Resolves what the signed-in user may do. The result only shapes the UI;
 * the database evaluates the same rules on every request.
 */
export function useAccessGate(): AccessGateState {
  const user = useCurrentUser();
  const [filter, setFilter] = useState<string | null>(readStoredFilter);

  const access = useQuery({ queryKey: qk.access(user.id), queryFn: fetchMyAccess, refetchInterval: ACCESS_REFRESH_MS });
  const ready = access.data?.account_type != null;
  const organization = useQuery({ queryKey: qk.organization(), queryFn: fetchOrganization, enabled: ready });
  const settings = useQuery({ queryKey: qk.settings(), queryFn: fetchSettings, enabled: ready });

  const { setBilingualDefault } = useI18n();
  useEffect(() => {
    setDisplayTimeZone(settings.data?.timezone);
  }, [settings.data?.timezone]);
  useEffect(() => {
    setBilingualDefault(Boolean(settings.data?.preferences.bilingual_labels));
  }, [settings.data?.preferences.bilingual_labels, setBilingualDefault]);

  const setBranchFilter = useCallback((next: string | null) => {
    setFilter(next);
    try {
      if (next) localStorage.setItem(BRANCH_FILTER_KEY, next);
      else localStorage.removeItem(BRANCH_FILTER_KEY);
    } catch {
      /* per-viewer convenience only */
    }
  }, []);

  const value = useMemo<AccessContextValue | null>(() => {
    const a = access.data;
    if (!a || a.account_type === null || !organization.data || !settings.data) return null;
    const permissions = new Set(a.permissions);
    // A stored filter is only a preference; it must name one of the user's branches.
    const branchFilter = a.branches.some((b) => b.id === filter) ? filter : null;
    const primary = a.branches.find((b) => b.is_primary) ?? a.branches[0];
    const names = new Map(a.branches.map((b) => [b.id, b.name]));
    return {
      userId: a.user_id,
      fullName: a.full_name,
      account: a.account_type,
      isDoctor: a.account_type === 'primary_doctor',
      isAdmin: a.account_type === 'admin',
      staffId: a.staff_id,
      designation: a.designation,
      designationLabel: a.designation_label,
      permissions,
      can: (req) => satisfies(permissions, req),
      allBranches: a.all_branches,
      branches: a.branches,
      branchFilter,
      setBranchFilter,
      defaultBranchId: branchFilter ?? primary?.id ?? null,
      branchName: (id) => (id ? (names.get(id) ?? '—') : '—'),
      organization: organization.data,
      settings: settings.data,
    };
  }, [access.data, organization.data, settings.data, filter, setBranchFilter]);

  if (access.isError || organization.isError || settings.isError) {
    return {
      status: 'error',
      error: access.error ?? organization.error ?? settings.error,
      retry: () => {
        void access.refetch();
        void organization.refetch();
        void settings.refetch();
      },
    };
  }
  if (access.data && access.data.account_type === null) return { status: 'no_access', reason: access.data.reason };
  if (!value) return { status: 'loading' };
  return { status: 'ready', value };
}

export function AccessProvider({ value, children }: { value: AccessContextValue; children: ReactNode }) {
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error('useAccess must be used inside AccessProvider');
  return ctx;
}

/** Test helper. */
export const AccessContextForTests = AccessContext;
