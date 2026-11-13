import { latestLinkedChartBalances, practiceChartPoints, type PracticeChartBalance } from '@/lib/practiceChartData';

const balance = (overrides: Partial<PracticeChartBalance> = {}): PracticeChartBalance => ({
  id: 'balance-1', uploaded_file_id: 'file-1', anno_esercizio: 2025, created_at: '2026-01-01',
  ricavi_vendite: 100, utile_netto: 0, ...overrides,
});

describe('dati dei grafici della pratica', () => {
  it('esclude analisi orfane e mantiene l’analisi più recente di ogni anno', () => {
    const result = latestLinkedChartBalances([
      balance(),
      balance({ id: 'latest', created_at: '2026-02-01' }),
      balance({ id: 'old-year', anno_esercizio: 2024 }),
      balance({ id: 'orphan', uploaded_file_id: null, anno_esercizio: 2023 }),
      balance({ id: 'deleted-file', uploaded_file_id: 'file-deleted', anno_esercizio: 2022 }),
      balance({ id: 'invalid-year', anno_esercizio: NaN }),
    ], new Set(['file-1']));
    expect(result.map(row => row.id)).toEqual(['latest', 'old-year']);
  });
  it('ordina il trend per anno e non converte dati mancanti in zero', () => {
    const points = practiceChartPoints([
      balance({ anno_esercizio: 2025, ricavi_vendite: 500 }),
      balance({ anno_esercizio: 2024, ricavi_vendite: 0, utile_netto: -12, totale_debiti: NaN }),
      balance({ anno_esercizio: 2023, ricavi_vendite: 0, voci_mancanti: ['ricavi_vendite'] }),
    ]);
    expect(points.map(point => point.anno)).toEqual(['2023', '2024', '2025']);
    expect(points[0].fatturato).toBeNull();
    expect(points[1].fatturato).toBe(0);
    expect(points[1].utile).toBe(-12);
    expect(points[1].debiti).toBeNull();
    expect(points[2].pd).toBeNull();
  });
});
