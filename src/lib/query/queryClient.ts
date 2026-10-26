import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isAuthError, isPermissionError } from '@/lib/errors';

export interface QueryErrorHandlers {
  /** The session is no longer valid (expired or revoked token). */
  onAuthError?: () => void;
  /** The server refused an action the UI thought was allowed — access may have changed. */
  onPermissionError?: () => void;
}

export function createQueryClient(handlers: QueryErrorHandlers = {}): QueryClient {
  const onError = (error: unknown) => {
    if (isAuthError(error)) handlers.onAuthError?.();
    else if (isPermissionError(error)) handlers.onPermissionError?.();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => !isPermissionError(error) && !isAuthError(error) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}
