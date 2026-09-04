import type { KpiScore } from '@/lib/generateReportPdf';

export interface KpiEntry {
  valore: number | null;
  formatted: string;
  semaforo: string;
  label: string;
}

export type KpiResult = Record<string, Record<string, KpiEntry>>;

export interface KpiScoringConfig {
  key: string;
  sourceKey: string;
  area: string;
  label: string;
  benchmarkKey: string;
  inverso: boolean;
  peso: number;
  ottimo: number;
  suff: number;
  critica: number;
}

export const KPI_SCORING_CONFIG: KpiScoringConfig[] = [
  { key: 'dscr', sourceKey: 'dscr', area: 'copertura', label: 'DSCR', benchmarkKey: 'DSCR', inverso: false, peso: 18, ottimo: 1.25, suff: 1, critica: 0.8 },
  { key: 'pfn_ebitda', sourceKey: 'pfn_ebitda', area: 'indebitamento', label: 'PFN / EBITDA', benchmarkKey: 'PFN / EBITDA', inverso: true, peso: 12, ottimo: 3, suff: 5, critica: 7 },
  { key: 'ebitda_margin', sourceKey: 'ebitda_margin', area: 'redditivita', label: 'EBITDA Margin (%)', benchmarkKey: 'EBITDA Margin', inverso: false, peso: 10, ottimo: 15, suff: 5, critica: 0 },
  { key: 'current_ratio', sourceKey: 'current_ratio', area: 'liquidita', label: 'Current Ratio', benchmarkKey: 'Current Ratio', inverso: false, peso: 7, ottimo: 1.5, suff: 1, critica: 0.8 },
  { key: 'quick_ratio', sourceKey: 'quick_ratio', area: 'liquidita', label: 'Quick Ratio', benchmarkKey: 'Quick Ratio', inverso: false, peso: 5, ottimo: 1, suff: 0.8, critica: 0.5 },
  { key: 'roe', sourceKey: 'roe', area: 'redditivita', label: 'ROE (%)', benchmarkKey: 'ROE', inverso: false, peso: 6, ottimo: 10, suff: 3, critica: 0 },
  { key: 'roi', sourceKey: 'roi', area: 'redditivita', label: 'ROI (%)', benchmarkKey: 'ROI', inverso: false, peso: 6, ottimo: 8, suff: 3, critica: 0 },
  { key: 'ros', sourceKey: 'ros', area: 'redditivita', label: 'ROS (%)', benchmarkKey: 'ROS', inverso: false, peso: 5, ottimo: 8, suff: 3, critica: 0 },
  { key: 'leverage', sourceKey: 'leverage', area: 'solidita', label: 'Leverage', benchmarkKey: 'Leverage', inverso: true, peso: 7, ottimo: 2.5, suff: 4, critica: 6 },
  { key: 'pfn_pn', sourceKey: 'pfn_pn', area: 'indebitamento', label: 'PFN / PN', benchmarkKey: 'PFN / PN', inverso: true, peso: 6, ottimo: 1, suff: 2, critica: 4 },
  { key: 'debt_equity', sourceKey: 'debt_equity', area: 'solidita', label: 'Debt/Equity', benchmarkKey: 'Debt/Equity', inverso: true, peso: 6, ottimo: 1.5, suff: 3, critica: 5 },
  { key: 'pn_totale_attivo', sourceKey: 'pn_su_ta', area: 'solidita', label: 'PN / Totale Attivo (%)', benchmarkKey: 'PN / Totale Attivo', inverso: false, peso: 5, ottimo: 40, suff: 25, critica: 15 },
  { key: 'dso', sourceKey: 'dso', area: 'efficienza', label: 'DSO (giorni)', benchmarkKey: 'DSO', inverso: true, peso: 3, ottimo: 60, suff: 90, critica: 120 },
  { key: 'interest_coverage', sourceKey: 'interest_coverage', area: 'copertura', label: 'Interest Coverage', benchmarkKey: 'Interest Coverage', inverso: false, peso: 4, ottimo: 3, suff: 1.5, critica: 1 },
];

export function calculateKpiScore(
  value: number,
  optimal: number,
  sufficient: number,
  critical: number,
  inverse: boolean,
): number {
  if (!inverse) {
    if (value >= optimal) return 100;
    if (value <= critical) return 0;
    if (value >= sufficient) return 55 + ((value - sufficient) / (optimal - sufficient)) * 45;
    return ((value - critical) / (sufficient - critical)) * 55;
  }

  if (value <= optimal) return 100;
  if (value >= critical) return 0;
  if (value <= sufficient) return 55 + ((sufficient - value) / (sufficient - optimal)) * 45;
  return ((critical - value) / (critical - sufficient)) * 55;
}

export interface BankabilityAssessment {
  scores: KpiScore[];
  indice: number | null;
  rating: 'bancabile' | 'attenzione' | 'non_bancabile' | null;
  motivi: string[];
  availableCount: number;
  totalCount: number;
}

export function buildBankabilityAssessment(kpi: KpiResult): BankabilityAssessment {
  const scores: KpiScore[] = KPI_SCORING_CONFIG.map(config => {
    const entry = kpi?.[config.area]?.[config.sourceKey];
    const value = entry?.valore ?? null;
    const score = value === null
      ? null
      : Math.round(Math.min(100, Math.max(0, calculateKpiScore(
          value,
          config.ottimo,
          config.suff,
          config.critica,
          config.inverso,
        ))));

    return {
      kpi_key: config.key,
      kpi_label: config.label,
      kpi_area: config.area,
      valore: value,
      formatted: entry?.formatted ?? (value !== null ? String(value) : 'N/D'),
      score,
      benchmark: config.ottimo,
      benchmark_formatted: String(config.ottimo),
      benchmark_key: config.benchmarkKey,
      inverso: config.inverso,
      peso: config.peso,
    };
  });

  const available = scores.filter(score => score.score !== null);
  if (available.length === 0) {
    return {
      scores,
      indice: null,
      rating: null,
      motivi: [],
      availableCount: 0,
      totalCount: KPI_SCORING_CONFIG.length,
    };
  }

  const weightedTotal = available.reduce((sum, score) => sum + (
    score.score! * (score.peso ?? 0)
  ), 0);
  const availableWeight = available.reduce((sum, score) => sum + (score.peso ?? 0), 0);
  const indice = availableWeight > 0
    ? Math.round((weightedTotal / availableWeight) * 100) / 100
    : null;
  const rating = indice === null
    ? null
    : indice >= 70
      ? 'bancabile'
      : indice >= 55
        ? 'attenzione'
        : 'non_bancabile';
  const motivi = scores
    .filter(score => score.score !== null && score.score < 55)
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
    .slice(0, 5)
    .map(score => `${score.kpi_label}: score ${score.score}/100`);

  return {
    scores,
    indice,
    rating,
    motivi,
    availableCount: available.length,
    totalCount: KPI_SCORING_CONFIG.length,
  };
}
