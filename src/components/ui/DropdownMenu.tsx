import * as Radix from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const DropdownMenu = Radix.Root;
export const DropdownMenuTrigger = Radix.Trigger;

export function DropdownMenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'center' | 'end'; className?: string }) {
  return (
    <Radix.Portal>
      <Radix.Content
        align={align}
        sideOffset={6}
        className={cn('z-dropdown min-w-[12rem] rounded-md border border-line bg-surface p-1 shadow-md', className)}
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Radix.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded px-2.5 py-2 text-sm outline-none',
        'data-[highlighted]:bg-sage data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        danger ? 'text-danger' : 'text-ink',
        '[&_svg]:size-4',
      )}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </Radix.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <Radix.Label className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">{children}</Radix.Label>;
}

export function DropdownMenuSeparator() {
  return <Radix.Separator className="my-1 h-px bg-line" />;
}
