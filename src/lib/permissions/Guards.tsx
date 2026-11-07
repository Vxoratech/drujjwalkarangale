import type { ReactNode } from 'react';
import { PermissionDenied } from '@/components/feedback/States';
import { useAccess } from '@/features/access/AccessProvider';
import type { PermissionRequirement } from './permissions';

/** Renders children only when the user holds the requirement; otherwise nothing (or `fallback`). */
export function Can({ requirement, children, fallback = null }: { requirement: PermissionRequirement; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAccess();
  return <>{can(requirement) ? children : fallback}</>;
}

/** Page-level guard that shows a permission-denied state. */
export function RequirePermission({ requirement, children }: { requirement: PermissionRequirement; children: ReactNode }) {
  const { can } = useAccess();
  if (!can(requirement)) return <PermissionDenied />;
  return <>{children}</>;
}
