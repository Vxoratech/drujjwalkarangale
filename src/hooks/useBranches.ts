import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/query/keys';
import { fetchBranches } from '@/services/organization';
import type { Branch, UUID } from '@/types/domain';

/** Every branch with full details (active and inactive), for management and print headers. */
export function useBranches(): { branches: Branch[]; byId: Map<UUID, Branch>; isLoading: boolean; isError: boolean; refetch: () => void } {
  const q = useQuery({ queryKey: qk.branches(), queryFn: fetchBranches, staleTime: 5 * 60_000 });
  const branches = q.data ?? [];
  return { branches, byId: new Map(branches.map((b) => [b.id, b])), isLoading: q.isLoading, isError: q.isError, refetch: () => void q.refetch() };
}
