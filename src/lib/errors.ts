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
];

const BY_CODE: Record<string, string> = {
  '42501': 'You do not have permission to do this.',
  '23505': 'This record already exists.',
  '23503': 'This refers to a record that no longer exists or belongs elsewhere.',
  '23514': 'Some values are not valid. Please review the form.',
  '23P01': 'This time slot overlaps another appointment for the same doctor.',
  P0002: 'The record could not be found.',
  PGRST116: 'The record could not be found or you do not have access to it.',
};

export function toUserMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error || typeof error !== 'object') return fallback;
  const e = error as BackendError;
  const message = e.message?.trim();
  if (message && SAFE_MESSAGES.some((re) => re.test(message))) {
    return message.endsWith('.') ? message : `${message}.`;
  }
  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code]!;
  if (message && /fetch|network/i.test(message)) return 'Unable to reach the server. Check your connection.';
  if (message?.includes('row-level security')) return BY_CODE['42501']!;
  return fallback;
}

export function isPermissionError(error: unknown): boolean {
  const e = error as BackendError | null;
  return e?.code === '42501' || e?.status === 403 || Boolean(e?.message?.includes('row-level security'));
}
