import {
  calculateProbabilityOfDefault,
  type DefaultProbabilityInput,
} from '@/lib/probabilityOfDefault';

export interface PracticeChartKpi {
  valore: number | null;
  formatted?: string;
  label?: string;
  source?: string;
  source_note?: string;
}

export interface PracticeChartBalance extends DefaultProbabilityInput {
  id: string;
  uploaded_file_id: string | null;
  anno_esercizio: number;
  created_at: string;
  ricavi_vendite?: number | null;
  kpi?: Record<string, Record<string, PracticeChartKpi>>;
}

/** Esclude analisi orfane e duplicati: un solo bilancio, il più recente, per anno. */
export function latestLinkedChartBalances(
  balances: PracticeChartBalance[],
  uploadedFileIds: ReadonlySet<string>,
): PracticeChartBalance[] {
  const years = new Map<number, PracticeChartBalance>();
  for (const balance of [...balances].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!balance.uploaded_file_id || !uploadedFileIds.has(balance.uploaded_file_id)) continue;
    if (!Number.isInteger(balance.anno_esercizio) || balance.anno_esercizio < 1900 || balance.anno_esercizio > 2100) continue;
    if (!years.has(balance.anno_esercizio)) years.set(balance.anno_esercizio, balance);
  }
  return [...years.values()].sort((a, b) => b.anno_esercizio - a.anno_esercizio);
}

export function chartAmount(balance: PracticeChartBalance, key: 'ricavi_vendite' | 'utile_netto' | 'totale_attivo' | 'totale_patrimonio_netto' | 'totale_debiti'): number | null {
  const value = balance[key];
  if (balance.voci_mancanti?.includes(key)) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function practiceChartPoints(balances: PracticeChartBalance[], ateco?: string | null) {
  return [...balances].sort((a, b) => a.anno_esercizio - b.anno_esercizio).map(balance => {
    const pd = calculateProbabilityOfDefault(balance, ateco);
    return {
      anno: String(balance.anno_esercizio),
      fatturato: chartAmount(balance, 'ricavi_vendite'),
      utile: chartAmount(balance, 'utile_netto'),
      attivo: chartAmount(balance, 'totale_attivo'),
      patrimonio: chartAmount(balance, 'totale_patrimonio_netto'),
      debiti: chartAmount(balance, 'totale_debiti'),
      pd: pd.status === 'estimated' ? pd.probability * 100 : null,
    };
  });
}
