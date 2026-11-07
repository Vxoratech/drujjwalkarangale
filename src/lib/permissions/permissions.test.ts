import { describe, expect, it } from 'vitest';
import { canCreatePrescription, canViewPatients, isPermission, satisfies, type Permission } from './permissions';

describe('permissions', () => {
  const granted = new Set<Permission>(['patients.view_basic', 'appointments.view']);
  const can = (r: Parameters<typeof satisfies>[1]) => satisfies(granted, r);

  it('passes when no requirement is given', () => {
    expect(satisfies(granted, undefined)).toBe(true);
  });

  it('checks a single permission', () => {
    expect(satisfies(granted, 'appointments.view')).toBe(true);
    expect(satisfies(granted, 'billing.view')).toBe(false);
  });

  it('treats arrays as any-of', () => {
    expect(satisfies(granted, ['billing.view', 'patients.view_basic'])).toBe(true);
    expect(satisfies(granted, ['billing.view', 'reports.financial'])).toBe(false);
  });

  it('exposes readable helpers', () => {
    expect(canViewPatients(can)).toBe(true);
    expect(canCreatePrescription(can)).toBe(false);
  });

  it('recognises valid keys only', () => {
    expect(isPermission('audit.view')).toBe(true);
    expect(isPermission('users.manage')).toBe(false);
  });
});
