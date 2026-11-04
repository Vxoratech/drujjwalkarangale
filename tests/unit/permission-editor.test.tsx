import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { effectiveSet, PermissionEditor } from '@/features/staff/PermissionEditor';
import type { PermissionDefinition } from '@/types/domain';
import { renderWithProviders } from './render';

const p = (key: string, extra: Partial<PermissionDefinition> = {}): PermissionDefinition => {
  const [module, action] = key.split('.') as [string, string];
  return { key, module, action, label: key, description: '', sensitivity: 'normal', doctor_only: false, position: 0, ...extra };
};
const CATALOG = [
  p('patients.view_basic'),
  p('appointments.cancel'),
  p('billing.view'),
  p('patients.view_history', { sensitivity: 'clinical' }),
  p('consultations.edit', { sensitivity: 'clinical', doctor_only: true }),
];

describe('effective permissions', () => {
  it('apply grants and denies on top of the template and never include doctor-only keys', () => {
    const set = effectiveSet(['patients.view_basic', 'appointments.cancel', 'consultations.edit'], { 'appointments.cancel': 'deny', 'billing.view': 'grant' }, CATALOG);
    expect([...set].sort()).toEqual(['billing.view', 'patients.view_basic']);
  });
});

describe('permission editor', () => {
  it('records a deny when a template permission is switched off and a grant when another is switched on', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionEditor catalog={CATALOG} template={['appointments.cancel']} overrides={{}} onChange={onChange} grantable={() => true} />);
    await userEvent.click(screen.getByRole('switch', { name: 'appointments.cancel' }));
    expect(onChange).toHaveBeenLastCalledWith({ template: ['appointments.cancel'], overrides: { 'appointments.cancel': 'deny' } });
    await userEvent.click(screen.getByRole('switch', { name: 'billing.view' }));
    expect(onChange).toHaveBeenLastCalledWith({ template: ['appointments.cancel'], overrides: { 'billing.view': 'grant' } });
  });

  it('asks for confirmation before granting clinical access', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionEditor catalog={CATALOG} template={[]} overrides={{}} onChange={onChange} grantable={() => true} />);
    await userEvent.click(screen.getByRole('switch', { name: 'patients.view_history' }));
    expect(onChange).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent("opens patients' clinical records");
    await userEvent.click(within(dialog).getByRole('button', { name: 'Grant permission' }));
    expect(onChange).toHaveBeenCalledWith({ template: [], overrides: { 'patients.view_history': 'grant' } });
  });

  it('locks doctor-only permissions and those outside the editor\'s authority', () => {
    renderWithProviders(<PermissionEditor catalog={CATALOG} template={[]} overrides={{}} onChange={() => undefined} grantable={(k) => k !== 'billing.view'} />);
    expect(screen.getByRole('switch', { name: 'consultations.edit' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'billing.view' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'patients.view_basic' })).toBeEnabled();
    expect(screen.getByText('Doctor only')).toBeInTheDocument();
  });
});
