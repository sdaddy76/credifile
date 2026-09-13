/**
 * Converte importi provenienti da PDF, CSV o database in numeri affidabili.
 *
 * Le fonti italiane usano normalmente il punto per le migliaia e la virgola
 * per i decimali (1.234.567,89), mentre le API possono restituire il formato
 * anglosassone (1234567.89). I placeholder non vengono mai trasformati in 0.
 */
export function parseLocalizedNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let normalized = String(value).trim().replace(/[€\s]/g, '');
  if (!normalized) return null;
  if (/^(?:-|—|–|n\/?d|n\.d\.|non disponibile)$/i.test(normalized)) return null;

  const negative = normalized.startsWith('(') && normalized.endsWith(')');
  if (negative) normalized = normalized.slice(1, -1);
  normalized = normalized.replace(/^\+/, '');

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // L'ultimo separatore è quello decimale: 1.234,56 oppure 1,234.56.
    normalized = lastComma > lastDot
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if ((normalized.match(/\./g) ?? []).length > 1) {
    normalized = normalized.replace(/\./g, '');
  } else if (lastDot >= 0) {
    // Un solo punto seguito da tre cifre è normalmente un separatore delle
    // migliaia (1.234); con una/due cifre è un decimale (1234.56).
    const fractionalDigits = normalized.length - lastDot - 1;
    if (fractionalDigits === 3) normalized = normalized.replace('.', '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : null;
}
