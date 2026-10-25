import type { PostgrestError } from '@supabase/supabase-js';

/** Throw backend errors as-is (UI maps them to safe messages); return typed data. */
export function unwrap<T>(result: { data: unknown; error: PostgrestError | null }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

export function unwrapPage<T>(result: { data: unknown; error: PostgrestError | null; count: number | null }): { rows: T[]; total: number } {
  if (result.error) throw result.error;
  return { rows: (result.data ?? []) as T[], total: result.count ?? 0 };
}

/** Escape user input for PostgREST `or()`/`ilike` filters. */
export function escapeFilter(value: string): string {
  return value.replace(/[%_,().*\\]/g, (c) => `\\${c}`).trim();
}

/** Convert empty strings from forms into nulls for nullable columns. */
export function emptyToNull<T extends Record<string, unknown>>(values: T): { [K in keyof T]: T[K] extends string ? T[K] | null : T[K] } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) out[k] = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
  return out as never;
}
