export interface SectorBenchmark {
  label: string;
  kpi: Partial<Record<string, number | null>>;
}

export const SECTOR_BENCHMARK_UPDATED_AT = '2023-12-31';

export const ATECO_SECTOR_MAP: [RegExp, string][] = [
  [/^0[1-3]/, 'agricoltura'],
  [/^0[5-9]/, 'estrazione'],
  [/^[12][0-9]|^3[0-3]/, 'manifattura'],
  [/^35/, 'energia'],
  [/^3[6-9]/, 'acqua_rifiuti'],
  [/^4[1-3]/, 'costruzioni'],
  [/^4[5-7]/, 'commercio'],
  [/^4[9]|^5[0-3]/, 'trasporti'],
  [/^5[5-6]/, 'ristorazione'],
  [/^5[8-9]|^6[0-3]/, 'ict'],
  [/^6[4-6]/, 'finanza'],
  [/^68/, 'immobiliare'],
  [/^6[9]|^7[0-5]/, 'professionali'],
  [/^7[7-9]|^8[0-2]/, 'amministrativi'],
  [/^86|^87|^88/, 'sanita'],
];

export const SECTOR_BENCHMARKS: Record<string, SectorBenchmark> = {
  agricoltura: {
    label: 'Agricoltura (A)',
    kpi: { 'Current Ratio': 1.3, 'Quick Ratio': 0.8, 'Debt/Equity': 1.5, Leverage: 2.5, 'PN / Totale Attivo': 40, 'Grado Indebitamento': 0.9, ROE: 5, ROI: 3, ROS: 5, 'EBITDA Margin': 12, 'PFN / EBITDA': 4.5, 'PFN / PN': 1.2, DSO: 60, 'Interest Coverage': 2.8, DSCR: 1.1 },
  },
  estrazione: {
    label: 'Estrazione (B)',
    kpi: { 'Current Ratio': 1.4, 'Quick Ratio': 1.1, 'Debt/Equity': 1.8, Leverage: 2.8, 'PN / Totale Attivo': 36, 'Grado Indebitamento': 1, ROE: 7, ROI: 5, ROS: 8, 'EBITDA Margin': 18, 'PFN / EBITDA': 3.8, 'PFN / PN': 1.4, DSO: 70, 'Interest Coverage': 3.5, DSCR: 1.2 },
  },
  manifattura: {
    label: 'Manifattura (C)',
    kpi: { 'Current Ratio': 1.4, 'Quick Ratio': 1, 'Debt/Equity': 1.8, Leverage: 2.8, 'PN / Totale Attivo': 36, 'Grado Indebitamento': 1.1, ROE: 8, ROI: 5, ROS: 4, 'EBITDA Margin': 9, 'PFN / EBITDA': 3.2, 'PFN / PN': 1.2, DSO: 85, 'Interest Coverage': 3.5, DSCR: 1.2 },
  },
  energia: {
    label: 'Energia (D)',
    kpi: { 'Current Ratio': 1.2, 'Quick Ratio': 1.1, 'Debt/Equity': 2.5, Leverage: 3.5, 'PN / Totale Attivo': 29, 'Grado Indebitamento': 1.5, ROE: 9, ROI: 5, ROS: 6, 'EBITDA Margin': 20, 'PFN / EBITDA': 5, 'PFN / PN': 1.8, DSO: 80, 'Interest Coverage': 2.5, DSCR: 1.1 },
  },
  acqua_rifiuti: {
    label: 'Acqua/Rifiuti (E)',
    kpi: { 'Current Ratio': 1.2, 'Quick Ratio': 1, 'Debt/Equity': 2.2, Leverage: 3.2, 'PN / Totale Attivo': 31, 'Grado Indebitamento': 1.2, ROE: 7, ROI: 4, ROS: 5, 'EBITDA Margin': 16, 'PFN / EBITDA': 4.5, 'PFN / PN': 1.5, DSO: 75, 'Interest Coverage': 2.8, DSCR: 1.1 },
  },
  costruzioni: {
    label: 'Costruzioni (F)',
    kpi: { 'Current Ratio': 1.3, 'Quick Ratio': 1.1, 'Debt/Equity': 3, Leverage: 4, 'PN / Totale Attivo': 25, 'Grado Indebitamento': 1.4, ROE: 10, ROI: 5, ROS: 3, 'EBITDA Margin': 8, 'PFN / EBITDA': 4.5, 'PFN / PN': 2, DSO: 110, 'Interest Coverage': 2.2, DSCR: 1.1 },
  },
  commercio: {
    label: 'Commercio (G)',
    kpi: { 'Current Ratio': 1.2, 'Quick Ratio': 0.7, 'Debt/Equity': 2.2, Leverage: 3.2, 'PN / Totale Attivo': 31, 'Grado Indebitamento': 1.2, ROE: 9, ROI: 6, ROS: 2, 'EBITDA Margin': 5, 'PFN / EBITDA': 3.8, 'PFN / PN': 1.4, DSO: 65, 'Interest Coverage': 2.8, DSCR: 1.15 },
  },
  trasporti: {
    label: 'Trasporti (H)',
    kpi: { 'Current Ratio': 1.1, 'Quick Ratio': 1, 'Debt/Equity': 2.5, Leverage: 3.5, 'PN / Totale Attivo': 29, 'Grado Indebitamento': 1.3, ROE: 7, ROI: 4, ROS: 3, 'EBITDA Margin': 10, 'PFN / EBITDA': 5, 'PFN / PN': 1.6, DSO: 55, 'Interest Coverage': 2.2, DSCR: 1.1 },
  },
  ristorazione: {
    label: 'Ristorazione/Alloggio (I)',
    kpi: { 'Current Ratio': 0.9, 'Quick Ratio': 0.8, 'Debt/Equity': 2.8, Leverage: 3.8, 'PN / Totale Attivo': 26, 'Grado Indebitamento': 1.5, ROE: 6, ROI: 4, ROS: 5, 'EBITDA Margin': 14, 'PFN / EBITDA': 5.5, 'PFN / PN': 1.8, DSO: 30, 'Interest Coverage': 2, DSCR: 1.05 },
  },
  ict: {
    label: 'ICT / Comunicazioni (J)',
    kpi: { 'Current Ratio': 1.8, 'Quick Ratio': 1.7, 'Debt/Equity': 0.8, Leverage: 1.8, 'PN / Totale Attivo': 55, 'Grado Indebitamento': 0.5, ROE: 14, ROI: 10, ROS: 10, 'EBITDA Margin': 18, 'PFN / EBITDA': 2, 'PFN / PN': 0.6, DSO: 65, 'Interest Coverage': 5.5, DSCR: 1.4 },
  },
  finanza: {
    label: 'Finanza / Assicurazioni (K)',
    kpi: { 'Current Ratio': 1.5, 'Quick Ratio': 1.4, 'Debt/Equity': 4, Leverage: 5, 'PN / Totale Attivo': 20, 'Grado Indebitamento': 2, ROE: 10, ROI: 3, ROS: 15, 'EBITDA Margin': 20, 'PFN / EBITDA': null, 'PFN / PN': 2, DSO: 45, 'Interest Coverage': 3, DSCR: 1.2 },
  },
  immobiliare: {
    label: 'Immobiliare (L)',
    kpi: { 'Current Ratio': 1.1, 'Quick Ratio': 0.9, 'Debt/Equity': 2, Leverage: 3, 'PN / Totale Attivo': 33, 'Grado Indebitamento': 1.5, ROE: 5, ROI: 3, ROS: 20, 'EBITDA Margin': 35, 'PFN / EBITDA': 8, 'PFN / PN': 1.8, DSO: 40, 'Interest Coverage': 2, DSCR: 1.1 },
  },
  professionali: {
    label: 'Servizi Professionali (M)',
    kpi: { 'Current Ratio': 1.6, 'Quick Ratio': 1.5, 'Debt/Equity': 1, Leverage: 2, 'PN / Totale Attivo': 50, 'Grado Indebitamento': 0.6, ROE: 12, ROI: 8, ROS: 8, 'EBITDA Margin': 15, 'PFN / EBITDA': 2, 'PFN / PN': 0.7, DSO: 80, 'Interest Coverage': 5, DSCR: 1.35 },
  },
  amministrativi: {
    label: 'Servizi Amministrativi (N)',
    kpi: { 'Current Ratio': 1.3, 'Quick Ratio': 1.2, 'Debt/Equity': 1.5, Leverage: 2.5, 'PN / Totale Attivo': 40, 'Grado Indebitamento': 0.8, ROE: 10, ROI: 7, ROS: 5, 'EBITDA Margin': 10, 'PFN / EBITDA': 2.5, 'PFN / PN': 0.9, DSO: 55, 'Interest Coverage': 4, DSCR: 1.25 },
  },
  sanita: {
    label: 'Sanità / Sociale (Q)',
    kpi: { 'Current Ratio': 1.4, 'Quick Ratio': 1.3, 'Debt/Equity': 1.2, Leverage: 2.2, 'PN / Totale Attivo': 45, 'Grado Indebitamento': 0.7, ROE: 8, ROI: 5, ROS: 6, 'EBITDA Margin': 12, 'PFN / EBITDA': 2.5, 'PFN / PN': 0.8, DSO: 70, 'Interest Coverage': 4, DSCR: 1.3 },
  },
};

export const SECTOR_DEFAULT: SectorBenchmark = {
  label: 'Media PMI italiane',
  kpi: { 'Current Ratio': 1.3, 'Quick Ratio': 1, 'Debt/Equity': 2, Leverage: 3, 'PN / Totale Attivo': 33, 'Grado Indebitamento': 1.2, ROE: 8, ROI: 5, ROS: 4, 'EBITDA Margin': 10, 'PFN / EBITDA': 3.5, 'PFN / PN': 1.2, DSO: 75, 'Interest Coverage': 3, DSCR: 1.2 },
};

export function getAtecoBenchmarkKey(codice: string | null | undefined): string {
  if (!codice) return 'default';
  const clean = codice.trim().replace(/[^0-9]/g, '');
  for (const [pattern, key] of ATECO_SECTOR_MAP) {
    if (pattern.test(clean)) return key;
  }
  return 'default';
}

export function getAtecoBenchmark(codice: string | null | undefined): SectorBenchmark {
  return SECTOR_BENCHMARKS[getAtecoBenchmarkKey(codice)] ?? SECTOR_DEFAULT;
}

export function fmtBenchmark(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (Math.abs(value) >= 100) return value.toLocaleString('it-IT', { maximumFractionDigits: 0 });
  return value.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
