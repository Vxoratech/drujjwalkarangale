import { useCallback, useState } from 'react';

/**
 * One key per user action. Reuse it for retries of the same submission (double
 * clicks, network retries); call `renew()` after success so the next action
 * gets a fresh key. The server stores the key and returns the original result
 * for a repeat, so money is never recorded twice.
 */
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const renew = useCallback(() => setKey(crypto.randomUUID()), []);
  return { key, renew };
}
