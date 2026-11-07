import { toast as sonner, Toaster as SonnerToaster } from 'sonner';
import { toUserMessage } from '@/lib/errors';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'font-sans border border-line bg-surface text-ink shadow-md rounded-md',
          description: 'text-ink-muted',
          success: '[&_[data-icon]]:text-success',
          error: '[&_[data-icon]]:text-danger',
        },
      }}
    />
  );
}

export const notify = {
  success: (message: string) => sonner.success(message),
  info: (message: string) => sonner(message),
  /** Shows a safe, user-facing message; never raw backend text. */
  error: (error: unknown, fallback?: string) => sonner.error(toUserMessage(error, fallback)),
};
