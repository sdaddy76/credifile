export interface DatedBalanceTransaction {
  data_valuta?: string | null;
  data_contabile?: string | null;
}

export interface ReferencedFinancing {
  data_riferimento?: string | null;
}

function yearFromDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim();
  const iso = normalized.match(/\b(\d{4})[-/]\d{1,2}[-/]\d{1,2}\b/);
  if (iso) return Number(iso[1]);
  const italian = normalized.match(/\b\d{1,2}[-/]\d{1,2}[-/](\d{4})\b/);
  if (italian) return Number(italian[1]);
  const yearOnly = normalized.match(/\b(19\d{2}|20\d{2})\b/);
  return yearOnly ? Number(yearOnly[1]) : null;
}

/**
 * Statement transactions are period data: only transactions dated in the
 * analyzed fiscal year can be used to derive a historical debt service.
 */
export function transactionsForBalanceYear<T extends DatedBalanceTransaction>(
  transactions: T[],
  fiscalYear: number | null | undefined,
): T[] {
  if (fiscalYear === null || fiscalYear === undefined) return transactions;
  return transactions.filter(transaction => {
    const year = yearFromDate(transaction.data_valuta ?? transaction.data_contabile);
    return year === fiscalYear;
  });
}

/**
 * A financing snapshot can inform an annual analysis only if its explicit
 * reference is not later than the analyzed fiscal year. Undated records are
 * retained for legacy manual entries whose effective date was never captured.
 */
export function financingForBalanceYear<T extends ReferencedFinancing>(
  financing: T[],
  fiscalYear: number | null | undefined,
  currentYear = new Date().getUTCFullYear(),
): T[] {
  if (fiscalYear === null || fiscalYear === undefined) return financing;
  return financing.filter(item => {
    const year = yearFromDate(item.data_riferimento);
    if (year !== null) return year <= fiscalYear;
    // Legacy/manual snapshots without a reference date are not safe for
    // analyzing a closed historical year: they may describe today's position.
    return fiscalYear >= currentYear;
  });
}
