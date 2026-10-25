import { QueryClient } from '@tanstack/react-query';
import { isPermissionError } from '@/lib/errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => !isPermissionError(error) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}
