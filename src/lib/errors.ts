import { translateCurrent, type TranslationKey } from '@/locales/i18n';
/**
 * Convert backend errors into safe, user-facing messages.
 * Raw database messages can contain record values, so only known messages
 * raised by our own RPCs/triggers are passed through; everything else is
 * mapped by error code to a generic sentence.
 */
export interface BackendError {
  code?: string;
  message?: string;
  status?: number;
}

/** Messages raised deliberately by our SQL (see supabase/migrations). */
const SAFE_MESSAGES: readonly RegExp[] = [
  /^A cancellation reason is required$/,
  /^Cannot change appointment from \w+ to \w+$/,
  /^Selected practitioner is not an active doctor in this clinic$/,
  /^Finalized consultations cannot be modified$/,
  /^Examination belongs to a finalized consultation$/,
  /^Only draft prescriptions can be issued$/,
  /^Add at least one medicine before issuing$/,
  /^Issued prescriptions can only be cancelled$/,
  /^An invoice needs at least one line item$/,
  /^Discount cannot (be negative|exceed the invoice amount)$/,
  /^Payment (amount must be positive|exceeds the outstanding balance|date cannot be in the future)$/,
  /^This invoice cannot accept payments$/,
  /^Invoices with recorded payments cannot be voided$/,
  /^A reason is required to void an invoice$/,
  /^A clinic must keep at least one active admin$/,
  /^Choose a date range of up to one year$/,
  /^You do not have permission to invite staff$/,
  /^Invalid login credentials$/,
  /^Your plan allows up to \d+ (doctors|branches|staff accounts)$/,
  /^A reason is required( to (revise a prescription|remove a document))?$/,
  /^A reason is required for a refund$/,
  /^Refund (amount must be positive|exceeds the amount paid)$/,
  /^Only issued prescriptions can be revised$/,
  /^Prescriptions are issued and revised only through the issue and revise actions$/,
  /^Issued prescriptions can only be cancelled or revised$/,
  /^Every template item needs a medicine, dose and frequency$/,
  /^(Unknown examination field|Invalid value for examination field): [a-z0-9_]+$/,
  /^Follow-up not found or already booked$/,
  /^The file has not been uploaded$/,
  /^Unknown time zone$/,
  /^Consent records can only be withdrawn$/,
  /^Withdrawn consents cannot be changed$/,
  /^This person is already a member of the clinic$/,
  /^No pending invitation$/,
];


const BY_CODE: Record<string, TranslationKey> = {
  '42501': 'errors.permission',
  '23505': 'errors.duplicate',
  '23503': 'errors.reference',
  '23514': 'errors.invalid',
  '23P01': 'errors.overlap',
  P0002: 'errors.notFound',
  PGRST116: 'errors.notFoundOrDenied',
};

/**
 * Server-raised business messages (SAFE_MESSAGES) are shown as written; generic
 * codes and fallbacks are translated into the active language.
 */
export function toUserMessage(error: unknown, fallback?: string): string {
  const generic = fallback ?? translateCurrent('errors.generic');
  if (!error || typeof error !== 'object') return generic;
  const e = error as BackendError;
  const message = e.message?.trim();
  if (message && SAFE_MESSAGES.some((re) => re.test(message))) {
    return message.endsWith('.') ? message : `${message}.`;
  }
  if (e.code && BY_CODE[e.code]) return translateCurrent(BY_CODE[e.code]!);
  if (message && /fetch|network/i.test(message)) return translateCurrent('errors.network');
  if (message?.includes('row-level security')) return translateCurrent('errors.permission');
  return generic;
}

/** Expired, missing or revoked JWT (PostgREST PGRST301/PGRST302, HTTP 401). */
export function isAuthError(error: unknown): boolean {
  const e = error as BackendError | null;
  return e?.status === 401 || e?.code === 'PGRST301' || e?.code === 'PGRST302' || Boolean(e?.message && /jwt expired|invalid jwt|refresh token/i.test(e.message));
}

export function isPermissionError(error: unknown): boolean {
  const e = error as BackendError | null;
  return e?.code === '42501' || e?.status === 403 || Boolean(e?.message?.includes('row-level security'));
}
