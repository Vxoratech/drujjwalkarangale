import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { qk } from '@/lib/query/keys';
import { fetchDoctors } from '@/services/clinic';

/** Active doctors in the clinic plus an id → name lookup. */
export function useDoctors() {
  const { clinicId } = useClinic();
  const query = useQuery({ queryKey: qk.doctors(clinicId), queryFn: () => fetchDoctors(clinicId), staleTime: 5 * 60_000 });
  const names = useMemo(() => new Map((query.data ?? []).map((d) => [d.user_id, d.full_name])), [query.data]);
  return { doctors: query.data ?? [], names, isLoading: query.isLoading };
}
