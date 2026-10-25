import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from '@/components/feedback/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { readEnv } from '@/lib/env';
import { createQueryClient } from '@/lib/query/queryClient';
import { I18nProvider } from '@/locales/i18n';
import { ConfigMissing } from './ConfigMissing';
import { createAppRouter } from './router';

export function App() {
  const [env] = useState(readEnv);
  const [queryClient] = useState(createQueryClient);
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
