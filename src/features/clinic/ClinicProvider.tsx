import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { qk } from '@/lib/query/keys';
import { satisfies, type Permission, type PermissionRequirement } from '@/lib/permissions/permissions';
import { fetchClinic, fetchMemberships, fetchPermissions } from '@/services/clinic';
import type { AppRole, Clinic, Membership } from '@/types/domain';

const ACTIVE_CLINIC_KEY = 'vaidyora.activeClinic';

export interface ClinicContextValue {
  clinicId: string;
  clinic: Clinic;
  membership: Membership;
  memberships: Membership[];
  roles: AppRole[];
  permissions: ReadonlySet<Permission>;
  can: (requirement: PermissionRequirement | undefined) => boolean;
  isDoctor: boolean;
  switchClinic: (clinicId: string) => void;
}

const ClinicContext = createContext<ClinicContextValue | null>(null);

function readStoredClinic(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CLINIC_KEY);
  } catch {
    return null;
  }
}

export type ClinicGateState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'no_membership' }
  | { status: 'ready'; value: ClinicContextValue };

/**
 * Resolves the active clinic for the signed-in user. The active clinic is a
 * UI preference only — it is validated against server-side memberships and
 * every query is still authorised by RLS.
 */
export function useClinicGate(): ClinicGateState {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(readStoredClinic);

  const memberships = useQuery({ queryKey: qk.memberships(user.id), queryFn: () => fetchMemberships(user.id) });
  const list = useMemo(() => memberships.data ?? [], [memberships.data]);
  const membership = list.find((m) => m.clinic_id === selected) ?? list[0];
  const clinicId = membership?.clinic_id;

  const permissions = useQuery({ queryKey: qk.permissions(clinicId ?? ''), queryFn: () => fetchPermissions(clinicId!), enabled: Boolean(clinicId) });
  const clinic = useQuery({ queryKey: qk.clinic(clinicId ?? ''), queryFn: () => fetchClinic(clinicId!), enabled: Boolean(clinicId) });

  useEffect(() => {
    if (clinicId) {
      try {
        localStorage.setItem(ACTIVE_CLINIC_KEY, clinicId);
      } catch {
        /* ignore */
      }
    }
  }, [clinicId]);

  const switchClinic = useCallback(
    (next: string) => {
      if (next === clinicId) return;
      // Drop the previous tenant's cached data before showing the next one.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === clinicId });
      setSelected(next);
    },
    [clinicId, queryClient],
  );

  const permissionSet = useMemo(() => new Set(permissions.data ?? []), [permissions.data]);

  const value = useMemo<ClinicContextValue | null>(() => {
    if (!membership || !clinic.data || !permissions.data) return null;
    return {
      clinicId: membership.clinic_id,
      clinic: clinic.data,
      membership,
      memberships: list,
      roles: membership.roles,
      permissions: permissionSet,
      can: (req) => satisfies(permissionSet, req),
      isDoctor: membership.roles.includes('doctor'),
      switchClinic,
    };
  }, [membership, clinic.data, permissions.data, permissionSet, list, switchClinic]);

  if (memberships.isError || permissions.isError || clinic.isError) {
    return {
      status: 'error',
      error: memberships.error ?? permissions.error ?? clinic.error,
      retry: () => {
        void memberships.refetch();
        void permissions.refetch();
        void clinic.refetch();
      },
    };
  }
  if (memberships.isSuccess && list.length === 0) return { status: 'no_membership' };
  if (!value) return { status: 'loading' };
  return { status: 'ready', value };
}

export function ClinicProvider({ value, children }: { value: ClinicContextValue; children: ReactNode }) {
  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}

export function useClinic(): ClinicContextValue {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error('useClinic must be used inside ClinicProvider');
  return ctx;
}

/** Test/Storybook helper. */
export const ClinicContextForTests = ClinicContext;
