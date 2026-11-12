import { generateReportPdf, type ReportData } from '@/lib/generateReportPdf';

const makeReportData = (historical = true): ReportData => ({
  ragione_sociale: 'Impresa di prova S.r.l.',
  anno_bilancio: 2025,
  indice_bancabilita: 72,
  kpi_scores: [
    {
      kpi_key: 'ebitda_margin', kpi_label: 'EBITDA Margin (%)', kpi_area: 'redditivita',
      valore: 12, formatted: '12%', score: 70, benchmark: 15, benchmark_formatted: '15',
      benchmark_key: 'EBITDA Margin', inverso: false,
    },
    {
      kpi_key: 'current_ratio', kpi_label: 'Current Ratio', kpi_area: 'liquidita',
      valore: 1.4, formatted: '1,40', score: 60, benchmark: 1.5, benchmark_formatted: '1,5',
      benchmark_key: 'Current Ratio', inverso: false,
    },
  ],
  top3: [],
  bottom3: [],
  ai_suggerimenti: [],
  consulente_nome: 'Consulente di prova',
  credifile_logo_url: '',
  settore_label: 'Commercio',
  benchmark_settore: { 'EBITDA Margin': 10, 'Current Ratio': 1.2 },
  ...(historical ? {
    storico_kpi: [
      { anno_bilancio: 2024, valori: { ebitda_margin: 9, current_ratio: 1.1 } },
      { anno_bilancio: 2025, valori: { ebitda_margin: 12, current_ratio: 1.4 } },
    ],
  } : {}),
});

describe('grafici nel report di bancabilità', () => {
  beforeEach(() => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
  });

  afterEach(() => jest.restoreAllMocks());

  it('genera le sezioni benchmark e trend quando sono disponibili due esercizi', async () => {
    const { pdfBlob } = await generateReportPdf(makeReportData());
    const pdf = new TextDecoder('windows-1252').decode(await pdfBlob.arrayBuffer());

    expect(pdf).toContain('GRAFICI DI SINTESI: AZIENDA VS SETTORE');
    expect(pdf).toContain('ANDAMENTO STORICO DEGLI INDICATORI');
    expect(pdf).toContain('(2024)');
    expect(pdf).toContain('(2025)');
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('non inventa un trend quando è disponibile un solo esercizio', async () => {
    const { pdfBlob } = await generateReportPdf(makeReportData(false));
    const pdf = new TextDecoder('windows-1252').decode(await pdfBlob.arrayBuffer());

    expect(pdf).toContain('Trend storico non disponibile');
  });
});
