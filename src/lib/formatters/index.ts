import type { DateString, Paise, Timestamp } from '@/types/domain';

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

let displayTimeZone = DEFAULT_TIME_ZONE;
const cache = new Map<string, Intl.DateTimeFormat>();

/** Set by the clinic context so all formatting uses the clinic's configured time zone. */
export function setDisplayTimeZone(tz: string | null | undefined): void {
  displayTimeZone = tz || DEFAULT_TIME_ZONE;
}

export function getDisplayTimeZone(): string {
  return displayTimeZone;
}

function fmt(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${displayTimeZone}|${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: displayTimeZone });
    cache.set(key, f);
  }
  return f;
}

const dateFmt = { format: (d: Date) => fmt('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) };
const timeFmt = { format: (d: Date) => fmt('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d) };
const longDateFmt = { format: (d: Date) => fmt('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d) };
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

/** Today's date in the clinic time zone as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): DateString {
  return fmt('en-CA', {}).format(now);
}

/** UTC offset of the display time zone at a given instant, e.g. "+05:30". */
function offsetFor(date: DateString, time = '12:00'): string {
  const probe = new Date(`${date}T${time}:00Z`);
  const part = fmt('en-US', { timeZoneName: 'longOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(part);
  return m ? `${m[1]}:${m[2] ?? '00'}` : '+00:00';
}

export function addDaysISO(date: DateString, days: number): DateString {
  const d = parseDateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Start/end instants (ISO) of a calendar day in the clinic time zone. */
export function istDayRange(date: DateString): { from: Timestamp; to: Timestamp } {
  const next = addDaysISO(date, 1);
  return {
    from: new Date(`${date}T00:00:00${offsetFor(date, '00:00')}`).toISOString(),
    to: new Date(`${next}T00:00:00${offsetFor(next, '00:00')}`).toISOString(),
  };
}

/** Combine a YYYY-MM-DD date and HH:mm time in the clinic time zone into an ISO instant. */
export function istDateTimeToISO(date: DateString, time: string): Timestamp {
  return new Date(`${date}T${time}:00${offsetFor(date, time)}`).toISOString();
}

/** Split an ISO instant into clinic-time-zone date and HH:mm. */
export function isoToIstParts(value: Timestamp): { date: DateString; time: string } {
  const d = new Date(value);
  return { date: fmt('en-CA', {}).format(d), time: fmt('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d) };
}

export function ageFromDob(dob: DateString | null | undefined, today: DateString = todayISO()): number | null {
  if (!dob) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty! - by!;
  if (tm! < bm! || (tm === bm && td! < bd!)) age -= 1;
  return age;
}

/** Age label: exact from DOB, or "~45" from the approximate age recorded at registration. */
export function ageLabel(p: { date_of_birth: DateString | null; approx_age_years?: number | null; registered_on?: DateString | null }): string {
  const exact = ageFromDob(p.date_of_birth);
  if (exact !== null) return String(exact);
  if (p.approx_age_years === null || p.approx_age_years === undefined) return '—';
  const yearsSince = p.registered_on ? Math.max(0, (ageFromDob(p.registered_on) ?? 0)) : 0;
  return `~${p.approx_age_years + yearsSince}`;
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
