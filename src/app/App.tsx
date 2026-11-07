import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { notify, Toaster } from '@/components/feedback/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { readEnv } from '@/lib/env';
import { createQueryClient } from '@/lib/query/queryClient';
import { I18nProvider, translateCurrent } from '@/locales/i18n';
import { expireSession } from '@/services/auth';
import { ConfigMissing } from './ConfigMissing';
import { createAppRouter } from './router';

export function App() {
  const [env] = useState(readEnv);
  const [queryClient] = useState(() => {
    let lastAccessNotice = 0;
    const client = createQueryClient({
      onAuthError: () => void expireSession(),
      onPermissionError: () => {
        // Roles or membership may have changed server-side: refresh access now.
        void client.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'memberships' || q.queryKey[1] === 'permissions' });
        if (Date.now() - lastAccessNotice > 30_000) {
          lastAccessNotice = Date.now();
          notify.info(translateCurrent('common.accessChanged'));
        }
      },
    });
    return client;
  });
  const [router] = useState(() => (env.ok ? createAppRouter() : null));

  return (
    <I18nProvider>
      {!env.ok || !router ? (
        <ConfigMissing missing={env.ok ? [] : env.missing} />
      ) : (
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AuthProvider>
              <RouterProvider router={router} />
            </AuthProvider>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      )}
    </I18nProvider>
  );
}
