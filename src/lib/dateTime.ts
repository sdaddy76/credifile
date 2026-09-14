/**
 * Fuso orario applicativo ufficiale di Credifile.
 * I timestamp in Supabase restano in UTC; questo helper garantisce che le
 * date mostrate nei portali e nei report siano sempre quelle di Roma,
 * indipendentemente dal fuso configurato sul dispositivo dell'utente.
 */
export const APP_TIME_ZONE = 'Europe/Rome';

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRomeDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options,
    timeZone: APP_TIME_ZONE,
  }).format(date);
}

export function formatRomeDateTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
    ...options,
    timeZone: APP_TIME_ZONE,
  }).format(date);
}

export function formatRomeTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
    timeZone: APP_TIME_ZONE,
  }).format(date);
}
