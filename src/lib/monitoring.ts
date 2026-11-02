/**
 * Error monitoring that never carries patient details.
 *
 * Reports include only: the error's type and code, the route PATTERN (ids and
 * query strings removed), the app environment and a timestamp. Messages, stack
 * traces with data, request bodies and URLs with ids are never sent. Plug a
 * provider in with `setErrorSink` (e.g. a Sentry transport with
 * `sendDefaultPii: false` and breadcrumbs disabled); without one, development
 * builds log to the console and production builds stay silent.
 */
export interface ErrorReport {
  kind: string;
  code?: string;
  status?: number;
  route: string;
  source: 'route' | 'query' | 'mutation' | 'manual';
  env: string;
  at: string;
}

type Sink = (report: ErrorReport) => void;
let sink: Sink | null = null;

export function setErrorSink(next: Sink | null): void {
  sink = next;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/patients/7d1c…?q=Sunita" → "/patients/:id" */
export function routePattern(pathname: string): string {
  return pathname.split('?')[0]!.split('#')[0]!.replace(UUID, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');
}

/** Build a scrubbed report: no messages, no values, no ids. */
export function buildReport(error: unknown, source: ErrorReport['source'], pathname: string): ErrorReport {
  const e = (error && typeof error === 'object' ? error : {}) as { name?: unknown; code?: unknown; status?: unknown };
  const code = typeof e.code === 'string' && /^[A-Z0-9_]{2,12}$/i.test(e.code) ? e.code : undefined;
  return {
    kind: error instanceof Error ? error.name : typeof e.name === 'string' ? e.name.slice(0, 40) : typeof error,
    code,
    status: typeof e.status === 'number' ? e.status : undefined,
    route: routePattern(pathname),
    source,
    env: String(import.meta.env.VITE_APP_ENV ?? 'development'),
    at: new Date().toISOString(),
  };
}

export function reportError(error: unknown, source: ErrorReport['source'] = 'manual'): void {
  const report = buildReport(error, source, typeof window === 'undefined' ? '/' : window.location.pathname);
  if (sink) {
    try {
      sink(report);
    } catch {
      /* monitoring must never break the app */
    }
  } else if (import.meta.env.DEV) {
    console.warn('[vaidyora:error]', report);
  }
}
