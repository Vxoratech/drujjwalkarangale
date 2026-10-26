/** Permission keys — must match public.permissions in the database. */
export const PERMISSIONS = [
  'patients.read_all',
  'patients.read_assigned',
  'patients.create',
  'patients.update',
  'appointments.read_all',
  'appointments.read_own',
  'appointments.manage',
  'appointments.update_own',
  'clinical.read_all',
  'clinical.read_assigned',
  'clinical.write',
  'prescriptions.read_all',
  'billing.read',
  'billing.create',
  'billing.void',
  'payments.record',
  'payments.refund',
  'subscription.read',
  'consents.manage',
  'reports.read',
  'settings.manage',
  'users.read',
  'users.manage',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * A requirement is a single permission, or an array meaning "any of".
 * UI checks only shape what is shown; the database enforces every rule.
 */
export type PermissionRequirement = Permission | readonly Permission[];

export function satisfies(granted: ReadonlySet<Permission>, requirement: PermissionRequirement | undefined): boolean {
  if (!requirement) return true;
  if (typeof requirement === 'string') return granted.has(requirement);
  return requirement.some((p) => granted.has(p));
}

export const CAN_VIEW_PATIENTS: readonly Permission[] = ['patients.read_all', 'patients.read_assigned'];
export const CAN_VIEW_SCHEDULE: readonly Permission[] = ['appointments.read_all', 'appointments.read_own'];
export const CAN_VIEW_CLINICAL: readonly Permission[] = ['clinical.read_all', 'clinical.read_assigned'];
