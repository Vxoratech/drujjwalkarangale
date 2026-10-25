import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column, type SortState } from '@/components/data-display/DataTable';
import { EmptyState } from '@/components/feedback/States';
import { FormField } from '@/components/forms/FormField';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Input, RadioGroup } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/Tabs';
import { Can, RequirePermission } from '@/lib/permissions/Guards';
import { renderWithProviders } from './render';

describe('FormField', () => {
  it('links label, hint and error to the control', () => {
    renderWithProviders(
      <FormField label="Mobile number" hint="10 digits" error="Enter a valid phone number." required>
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText(/Mobile number/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid phone number.');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid phone number.');
  });
});

describe('Button', () => {
  it('disables itself and exposes busy state while loading', () => {
    renderWithProviders(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('icon buttons require an accessible name', () => {
    renderWithProviders(<IconButton label="Open navigation" icon={<span />} />);
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
  });
});

interface Row {
  id: string;
  name: string;
  amount: number;
}

function SortableTable({ onSort }: { onSort: (s: SortState) => void }) {
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Name', sortable: true, cell: (r) => r.name },
    { key: 'amount', header: 'Amount', sortable: true, align: 'right', cell: (r) => r.amount },
  ];
  return (
    <DataTable
      caption="Rows"
      columns={columns}
      rows={[
        { id: '1', name: 'Asha', amount: 10 },
        { id: '2', name: 'Ravi', amount: 5 },
      ]}
      rowKey={(r) => r.id}
      sort={sort}
      onSortChange={(s) => {
        setSort(s);
        onSort(s);
      }}
      pagination={{ page: 1, pageSize: 20, total: 2, onPageChange: () => undefined }}
    />
  );
}

describe('DataTable', () => {
  it('announces sort state and toggles direction', async () => {
    const onSort = vi.fn();
    renderWithProviders(<SortableTable onSort={onSort} />);
    const table = screen.getByRole('table', { name: 'Rows' });
    const nameHeader = within(table).getByRole('columnheader', { name: /Name/ });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(within(nameHeader).getByRole('button'));
    expect(onSort).toHaveBeenCalledWith({ key: 'name', direction: 'desc' });
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByText('Showing 1–2 of 2')).toBeInTheDocument();
  });

  it('renders the empty state when there are no rows', () => {
    renderWithProviders(<DataTable caption="Empty" columns={[]} rows={[]} rowKey={() => ''} empty={<EmptyState title="No patients yet" />} />);
    expect(screen.getByText('No patients yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('selection controls', () => {
  it('RadioGroup is keyboard reachable and reports selection', async () => {
    const onChange = vi.fn();
    renderWithProviders(<RadioGroup name="agni" legend="Agni" value="sama" onChange={onChange} options={[{ value: 'sama', label: 'Sama' }, { value: 'manda', label: 'Manda' }]} />);
    expect(screen.getByRole('radio', { name: 'Sama' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Manda' }));
    expect(onChange).toHaveBeenCalledWith('manda');
  });

  it('SegmentedControl exposes radio semantics', async () => {
    const onChange = vi.fn();
    renderWithProviders(<SegmentedControl label="Range" value="a" onChange={onChange} options={[{ value: 'a', label: 'Week' }, { value: 'b', label: 'Month' }]} />);
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('ConfirmDialog', () => {
  it('keeps the dialog open when the action fails', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error('nope'));
    renderWithProviders(<ConfirmDialog open onOpenChange={onOpenChange} title="Finalize?" body="Locked after." confirmLabel="Finalize" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Finalize' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('permission guards', () => {
  it('Can hides content without the permission', () => {
    renderWithProviders(
      <>
        <Can requirement="billing.read">
          <p>Revenue</p>
        </Can>
        <Can requirement="clinical.write">
          <p>Write consultation</p>
        </Can>
      </>,
      { permissions: ['clinical.write'] },
    );
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument();
    expect(screen.getByText('Write consultation')).toBeInTheDocument();
  });

  it('RequirePermission renders a permission-denied state', () => {
    renderWithProviders(
      <RequirePermission requirement="audit.read">
        <p>Audit</p>
      </RequirePermission>,
      { permissions: ['patients.read_assigned'] },
    );
    expect(screen.queryByText('Audit')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access');
  });

  it('renders localized Marathi copy', () => {
    renderWithProviders(
      <RequirePermission requirement="audit.read">
        <p>Audit</p>
      </RequirePermission>,
      { permissions: [], locale: 'mr' },
    );
    expect(screen.getByRole('alert')).toHaveTextContent('आपल्याला प्रवेश नाही');
  });
});
