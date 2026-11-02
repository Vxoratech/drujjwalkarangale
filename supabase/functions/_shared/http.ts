import { corsHeaders } from './cors.ts';

export function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/**
 * Fixed-window rate limit backed by public.consume_rate_limit (service role).
 * Fails closed: if the limiter itself errors, the request is refused.
 */
// deno-lint-ignore no-explicit-any
export async function withinRateLimit(admin: any, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc('consume_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    console.error('rate-limit check failed', error.code);
    return false;
  }
  return data === true;
}

/** Largest JSON body the functions accept; larger requests are refused before parsing. */
export const MAX_BODY_BYTES = 8 * 1024;

/**
 * Read a JSON body with a hard size cap, so oversized payloads can't exhaust
 * memory during parsing or schema validation. Returns null if too large or invalid.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
