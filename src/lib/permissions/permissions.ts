/** Permission keys — must match public.permissions in the database. */
export const PERMISSIONS = [
  'patients.view_basic',
  'patients.view_history',
  'patients.create',
  'patients.edit_contact',
  'patients.edit',
  'patients.delete',
  'patients.export',
  'consents.manage',
  'appointments.view',
  'appointments.create',
  'appointments.reschedule',
  'appointments.cancel',
  'appointments.update_status',
  'consultations.view',
  'consultations.create',
  'consultations.edit',
  'examinations.view',
  'examinations.edit',
  'prescriptions.view',
  'prescriptions.create',
  'prescriptions.finalize',
  'prescriptions.print',
  'investigations.view',
  'investigations.order',
  'investigations.upload',
  'investigations.manage',
  'documents.view',
  'documents.delete',
  'follow_ups.view',
  'follow_ups.manage',
  'billing.view',
  'billing.create',
  'billing.void',
  'billing.export',
  'payments.record',
  'payments.refund',
  'payments.reconcile',
  'reports.operational',
  'reports.financial',
  'reports.clinical',
  'staff.view',
  'staff.manage',
  'staff.permissions',
  'branches.manage',
  'settings.branch',
  'settings.organization',
  'audit.view',
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

/** Named requirements used by navigation, route guards and actions. */
export const REQUIRES = {
  viewPatients: ['patients.view_basic', 'billing.view'],
  createPatient: 'patients.create',
  editPatient: ['patients.edit_contact', 'patients.edit'],
  viewSchedule: 'appointments.view',
  manageAppointments: ['appointments.create', 'appointments.reschedule', 'appointments.cancel', 'appointments.update_status'],
  viewConsultations: 'consultations.view',
  writeConsultations: 'consultations.create',
  viewExaminations: 'examinations.view',
  viewPrescriptions: 'prescriptions.view',
  createPrescription: 'prescriptions.create',
  finalizePrescription: 'prescriptions.finalize',
  viewInvestigations: ['investigations.view', 'investigations.upload'],
  viewFollowUps: 'follow_ups.view',
  viewBilling: 'billing.view',
  manageBilling: ['billing.create', 'payments.record', 'payments.refund', 'billing.void'],
  viewReports: ['reports.operational', 'reports.financial', 'reports.clinical'],
  manageStaff: ['staff.view', 'staff.manage'],
  managePermissions: 'staff.permissions',
  manageBranches: ['branches.manage', 'settings.branch'],
  manageSettings: 'settings.organization',
  viewAuditLogs: 'audit.view',
} as const satisfies Record<string, PermissionRequirement>;

type Checker = (requirement: PermissionRequirement | undefined) => boolean;

/** Readable helpers for components: `canViewPatients(can)`. */
export const canViewPatients = (can: Checker) => can(REQUIRES.viewPatients);
export const canCreatePatient = (can: Checker) => can(REQUIRES.createPatient);
export const canEditPatient = (can: Checker) => can(REQUIRES.editPatient);
export const canManageAppointments = (can: Checker) => can(REQUIRES.manageAppointments);
export const canViewConsultations = (can: Checker) => can(REQUIRES.viewConsultations);
export const canCreatePrescription = (can: Checker) => can(REQUIRES.createPrescription);
export const canFinalizePrescription = (can: Checker) => can(REQUIRES.finalizePrescription);
export const canManageStaff = (can: Checker) => can('staff.manage');
export const canManageBranches = (can: Checker) => can('branches.manage');
export const canViewBilling = (can: Checker) => can(REQUIRES.viewBilling);
export const canManageBilling = (can: Checker) => can(REQUIRES.manageBilling);
export const canViewReports = (can: Checker) => can(REQUIRES.viewReports);
export const canViewAuditLogs = (can: Checker) => can(REQUIRES.viewAuditLogs);
