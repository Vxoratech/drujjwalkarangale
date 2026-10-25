import { describe, expect, it } from 'vitest';
import { isPermission, satisfies, type Permission } from './permissions';

describe('permissions', () => {
  const granted = new Set<Permission>(['patients.read_assigned', 'clinical.write']);

  it('passes when no requirement is given', () => {
    expect(satisfies(granted, undefined)).toBe(true);
  });

  it('checks a single permission', () => {
    expect(satisfies(granted, 'clinical.write')).toBe(true);
    expect(satisfies(granted, 'billing.read')).toBe(false);
  });

  it('treats arrays as any-of', () => {
    expect(satisfies(granted, ['patients.read_all', 'patients.read_assigned'])).toBe(true);
    expect(satisfies(granted, ['billing.read', 'reports.read'])).toBe(false);
  });

  it('recognises valid keys only', () => {
    expect(isPermission('audit.read')).toBe(true);
    expect(isPermission('audit.delete')).toBe(false);
  });
});
