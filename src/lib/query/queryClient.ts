import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isAuthError, isPermissionError } from '@/lib/errors';
import { reportError } from '@/lib/monitoring';

export interface QueryErrorHandlers {
  /** The session is no longer valid (expired or revoked token). */
  onAuthError?: () => void;
  /** The server refused an action the UI thought was allowed — access may have changed. */
  onPermissionError?: () => void;
}

export function createQueryClient(handlers: QueryErrorHandlers = {}): QueryClient {
  const onError = (source: 'query' | 'mutation') => (error: unknown) => {
    if (isAuthError(error)) handlers.onAuthError?.();
    else if (isPermissionError(error)) handlers.onPermissionError?.();
    else reportError(error, source);
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: onError('query') }),
    mutationCache: new MutationCache({ onError: onError('mutation') }),
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
