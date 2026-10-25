import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Pagination, type PaginationProps } from './Pagination';

export type SortDirection = 'asc' | 'desc';
export interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Hide below this breakpoint in table mode. */
  hideBelow?: 'sm' | 'md' | 'lg';
  className?: string;
}

export interface DataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowClick?: (row: T) => void;
  /** Card renderer used below the md breakpoint instead of the table. */
  mobileCard?: (row: T) => ReactNode;
  pagination?: PaginationProps;
  /** Rendered when `rows` is empty. */
  empty?: ReactNode;
}

const hideMap = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;
const alignMap = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({ caption, columns, rows, rowKey, sort, onSortChange, onRowClick, mobileCard, pagination, empty }: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  function toggleSort(key: string) {
    if (!onSortChange) return;
    const direction: SortDirection = sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key, direction });
  }

  return (
    <div>
      {mobileCard && (
        <ul className="divide-y divide-line md:hidden" aria-label={caption}>
          {rows.map((row) => (
            <li key={rowKey(row)}>
              {onRowClick ? (
                <button type="button" className="block w-full px-4 py-3 text-left hover:bg-ivory" onClick={() => onRowClick(row)}>
                  {mobileCard(row)}
                </button>
              ) : (
                <div className="px-4 py-3">{mobileCard(row)}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className={cn('overflow-x-auto', mobileCard && 'hidden md:block')}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-ivory/60">
              {columns.map((col) => {
                const active = sort?.key === col.key;
                const ariaSort = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn('whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-muted', alignMap[col.align ?? 'left'], col.hideBelow && hideMap[col.hideBelow], col.className)}
                  >
                    {col.sortable && onSortChange ? (
                      <button type="button" onClick={() => toggleSort(col.key)} className="inline-flex items-center gap-1 rounded uppercase hover:text-ink">
                        {col.header}
                        {active ? (
                          sort!.direction === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('transition-colors duration-fast', onRowClick && 'cursor-pointer hover:bg-ivory')}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3 align-middle', alignMap[col.align ?? 'left'], col.hideBelow && hideMap[col.hideBelow], col.className)}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && <Pagination {...pagination} />}
    </div>
  );
}
