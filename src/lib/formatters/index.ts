import type { DateString, Paise, Timestamp } from '@/types/domain';

export const APP_TIME_ZONE = 'Asia/Kolkata';

const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true });
const longDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const intFmt = new Intl.NumberFormat('en-IN');

/** Parse a YYYY-MM-DD string as a calendar date (no time-zone shift). */
function parseDateOnly(value: DateString): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12));
}

function toDate(value: Timestamp | DateString | Date): Date {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateOnly(value) : new Date(value);
}

/** DD/MM/YYYY in Asia/Kolkata. */
export function formatDate(value: Timestamp | DateString | Date | null | undefined): string {
  if (!value) return '—';
  return dateFmt.format(toDate(value));
}

export function formatTime(value: Timestamp | Date | null | undefined): string {
  if (!value) return '—';
  return timeFmt.format(toDate(value)).replace('am', 'AM').replace('pm', 'PM');
}

export function formatDateTime(value: Timestamp | Date | null | undefined): string {
  if (!value) return '—';
  return `${formatDate(value)}, ${formatTime(value)}`;
}

export function formatLongDate(value: Timestamp | DateString | Date): string {
  return longDateFmt.format(toDate(value));
}

export function formatINR(paise: Paise | null | undefined, opts: { whole?: boolean } = {}): string {
  const rupees = (paise ?? 0) / 100;
  return (opts.whole ? inrWhole : inr).format(rupees);
}

export function formatNumber(value: number): string {
  return intFmt.format(value);
}

/** Convert a rupee amount typed by a user (e.g. "1,250.50") to integer paise. */
export function rupeesToPaise(input: string | number): Paise {
  const n = typeof input === 'number' ? input : Number(String(input).replace(/[,\s₹]/g, ''));
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

/** Today's date in Asia/Kolkata as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): DateString {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(now);
}

export function addDaysISO(date: DateString, days: number): DateString {
  const d = parseDateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Start/end instants (ISO) of a calendar day in Asia/Kolkata. */
export function istDayRange(date: DateString): { from: Timestamp; to: Timestamp } {
  return {
    from: new Date(`${date}T00:00:00+05:30`).toISOString(),
    to: new Date(`${addDaysISO(date, 1)}T00:00:00+05:30`).toISOString(),
  };
}

/** Combine a YYYY-MM-DD date and HH:mm time in Asia/Kolkata into an ISO instant. */
export function istDateTimeToISO(date: DateString, time: string): Timestamp {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

/** Split an ISO instant into Asia/Kolkata date and HH:mm. */
export function isoToIstParts(value: Timestamp): { date: DateString; time: string } {
  const d = new Date(value);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return { date, time };
}

export function ageFromDob(dob: DateString | null | undefined, today: DateString = todayISO()): number | null {
  if (!dob) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty! - by!;
  if (tm! < bm! || (tm === bm && td! < bd!)) age -= 1;
  return age;
}

export function fullName(person: { first_name: string; last_name?: string | null } | null | undefined): string {
  if (!person) return '—';
  return [person.first_name, person.last_name].filter(Boolean).join(' ');
}

export function initials(name: string): string {
  const parts = name.replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

/** Mask a phone number for list views, e.g. "+91 98••• ••001". */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return phone;
  return `••••• ${digits.slice(-4)}`;
}
