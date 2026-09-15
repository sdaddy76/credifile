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
  // Intl.DateTimeFormat non consente di combinare dateStyle/timeStyle con
  // componenti singoli (day, month, hour, ...). Le pagine chiamano spesso
  // questo helper con componenti personalizzati, quindi applichiamo gli
  // stili predefiniti solo quando non è stata fornita alcuna componente.
  const componentOptions: Array<keyof Intl.DateTimeFormatOptions> = [
    'weekday',
    'era',
    'year',
    'month',
    'day',
    'dayPeriod',
    'hour',
    'minute',
    'second',
    'timeZoneName',
  ];
  const hasIndividualComponents = componentOptions.some(key => options[key] !== undefined);
  return new Intl.DateTimeFormat('it-IT', {
    ...(hasIndividualComponents ? {} : { dateStyle: 'short', timeStyle: 'short' }),
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
