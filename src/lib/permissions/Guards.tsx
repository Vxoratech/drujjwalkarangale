import type { ReactNode } from 'react';
import { PermissionDenied } from '@/components/feedback/States';
import { useClinic } from '@/features/clinic/ClinicProvider';
import type { PermissionRequirement } from './permissions';

/** Renders children only when the user holds the requirement; otherwise nothing (or `fallback`). */
export function Can({ requirement, children, fallback = null }: { requirement: PermissionRequirement; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useClinic();
  return <>{can(requirement) ? children : fallback}</>;
}

/** Page-level guard that shows a permission-denied state. */
export function RequirePermission({ requirement, children }: { requirement: PermissionRequirement; children: ReactNode }) {
  const { can } = useClinic();
  if (!can(requirement)) return <PermissionDenied />;
  return <>{children}</>;
}
