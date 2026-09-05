import type { KpiScore } from '@/lib/generateReportPdf';
import {
  buildKpiBenchmarkComparison,
  buildKpiBenchmarkComparisons,
} from '@/lib/kpiBenchmarkComments';

function score(overrides: Partial<KpiScore> = {}): KpiScore {
  return {
    kpi_key: 'current_ratio',
    kpi_label: 'Current Ratio',
    kpi_area: 'liquidita',
    valore: 1.5,
    formatted: '1,50x',
    score: 100,
    benchmark: 1.5,
    benchmark_formatted: '1,50x',
    benchmark_key: 'Current Ratio',
    inverso: false,
    peso: 7,
    ...overrides,
  };
}

describe('commenti KPI con benchmark settoriale', () => {
  it('classifica un KPI diretto sopra il benchmark come punto di forza', () => {
    const comparison = buildKpiBenchmarkComparison(score({ valore: 1.6, formatted: '1,60x' }), {
      'Current Ratio': 1.2,
    });

    expect(comparison.judgement).toBe('Punto di forza');
    expect(comparison.tone).toBe('positive');
    expect(comparison.deltaFormatted).toBe('+0,40x');
    expect(comparison.comment).toContain('nettamente migliore del benchmark');
    expect(comparison.comment).toContain('valore più alto è preferibile');
  });

  it('inverte correttamente il giudizio per PFN/EBITDA e DSO', () => {
    const pfn = buildKpiBenchmarkComparison(score({
      kpi_key: 'pfn_ebitda',
      kpi_label: 'PFN / EBITDA',
      kpi_area: 'indebitamento',
      benchmark_key: 'PFN / EBITDA',
      valore: 5,
      formatted: '5,00x',
      inverso: true,
    }), { 'PFN / EBITDA': 3 });
    const dso = buildKpiBenchmarkComparison(score({
      kpi_key: 'dso',
      kpi_label: 'DSO (giorni)',
      kpi_area: 'efficienza',
      benchmark_key: 'DSO',
      valore: 45,
      formatted: '45 gg',
      inverso: true,
    }), { DSO: 60 });

    expect(pfn.judgement).toBe('Da approfondire');
    expect(pfn.comment).toContain('valore più basso è preferibile');
    expect(dso.judgement).toBe('Punto di forza');
    expect(dso.deltaFormatted).toBe('-15,0 gg');
  });

  it('gestisce valore o benchmark mancanti senza inventare confronti', () => {
    const missingValue = buildKpiBenchmarkComparison(score({ valore: null, formatted: 'N/D' }), {
      'Current Ratio': 1.2,
    });
    const missingBenchmark = buildKpiBenchmarkComparison(score(), {});

    expect(missingValue.judgement).toBe('N/D');
    expect(missingValue.comment).toContain('non è disponibile');
    expect(missingBenchmark.benchmarkFormatted).toBe('N/D');
    expect(missingBenchmark.comment).toContain('benchmark settoriale non è disponibile');
  });

  it('produce un commento per ogni KPI ricevuto', () => {
    const comparisons = buildKpiBenchmarkComparisons([
      score(),
      score({
        kpi_key: 'dscr',
        kpi_label: 'DSCR',
        kpi_area: 'copertura',
        benchmark_key: 'DSCR',
        valore: 1.3,
        formatted: '1,30x',
      }),
    ], {
      'Current Ratio': 1.4,
      DSCR: 1.2,
    });

    expect(comparisons).toHaveLength(2);
    expect(comparisons.every(item => item.comment.length > 80)).toBe(true);
  });
});
