import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

const overlay = 'fixed inset-0 z-modal bg-forest-deep/40 data-[state=open]:animate-[fade-in_150ms_ease-out]';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeLabel?: string;
}

const modalSizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

export function Modal({ open, onOpenChange, title, description, children, footer, size = 'md', closeLabel = 'Close' }: ModalProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlay} />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-modal flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-lg border border-line bg-surface shadow-lg focus-visible:outline-none',
            modalSizes[size],
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <RadixDialog.Title className="font-display text-lg font-semibold">{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="mt-1 text-sm text-ink-muted">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close className="-mr-1 rounded p-1 text-ink-muted hover:bg-sage hover:text-ink" aria-label={closeLabel}>
              <X className="size-5" aria-hidden />
            </RadixDialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<unknown> | void;
  /** Optional extra content (e.g. a reason field). */
  children?: ReactNode;
  confirmDisabled?: boolean;
}

export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, cancelLabel = 'Cancel', tone = 'primary', onConfirm, children, confirmDisabled }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      /* caller surfaces the error; keep dialog open */
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={handleConfirm} loading={busy} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-ink-muted">
        <div>{body}</div>
        {children}
      </div>
    </Modal>
  );
}

export interface DrawerProps extends Omit<ModalProps, 'size'> {
  side?: 'right' | 'left';
  width?: 'md' | 'lg';
}

export function Drawer({ open, onOpenChange, title, description, children, footer, side = 'right', width = 'md', closeLabel = 'Close' }: DrawerProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={cn(overlay, 'z-drawer')} />
        <RadixDialog.Content
          className={cn(
            'fixed inset-y-0 z-drawer flex w-full flex-col bg-surface shadow-lg focus-visible:outline-none',
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            'border-line',
            width === 'md' ? 'sm:max-w-lg' : 'sm:max-w-2xl',
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <RadixDialog.Title className="font-display text-lg font-semibold">{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="mt-1 text-sm text-ink-muted">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close className="-mr-1 rounded p-1 text-ink-muted hover:bg-sage hover:text-ink" aria-label={closeLabel}>
              <X className="size-5" aria-hidden />
            </RadixDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
