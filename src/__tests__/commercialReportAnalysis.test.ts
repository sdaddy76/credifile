import {
  annualizeBalanceFlows,
  buildCommercialReportAnalysis,
  COMMERCIAL_REPORT_SECTION_KEYS,
  getBalancePeriodMonths,
  type CommercialBalanceRecord,
} from '@/lib/commercialReportAnalysis';

const annual2025: CommercialBalanceRecord = {
  id: 'annual-2025',
  uploaded_file_id: 'annual-file-2025',
  anno_esercizio: 2025,
  ricavi_vendite: 1_200_000,
  totale_valore_produzione: 1_250_000,
  totale_costi_produzione: 1_100_000,
  ammortamenti: 30_000,
  utile_netto: 80_000,
  totale_attivo: 900_000,
  totale_patrimonio_netto: 360_000,
  totale_debiti: 500_000,
  disponibilita_liquide: 120_000,
  costi_materie: 480_000,
  costi_servizi: 220_000,
  costo_personale: 250_000,
  debiti_banche_breve: 50_000,
  debiti_banche_lungo: 150_000,
};

const annual2024: CommercialBalanceRecord = {
  ...annual2025,
  id: 'annual-2024',
  uploaded_file_id: 'annual-file-2024',
  anno_esercizio: 2024,
  ricavi_vendite: 1_000_000,
  totale_valore_produzione: 1_030_000,
  totale_costi_produzione: 930_000,
  ammortamenti: 20_000,
  utile_netto: 50_000,
  totale_patrimonio_netto: 300_000,
  totale_debiti: 520_000,
  disponibilita_liquide: 80_000,
  debiti_banche_breve: 70_000,
  debiti_banche_lungo: 180_000,
};

describe('commercialReportAnalysis', () => {
  it('commenta situazione, principali voci e confronto tra due esercizi', () => {
    const result = buildCommercialReportAnalysis({
      balances: [annual2024, annual2025],
    });

    expect(result.latestAnnual?.anno_esercizio).toBe(2025);
    expect(result.previousAnnual?.anno_esercizio).toBe(2024);
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.companySituation]).toContain('bilancio 2025');
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.mainBalanceItems]).toContain('Costi per materie');
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.yearOverYear]).toContain('Ricavi delle vendite');
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.yearOverYear]).toContain('+20,0%');
  });

  it('mantiene N/D per le voci mancanti senza trasformarle in zero', () => {
    const result = buildCommercialReportAnalysis({
      balances: [{
        anno_esercizio: 2025,
        ricavi_vendite: 500_000,
        totale_attivo: 300_000,
        costi_materie: null,
        debiti_banche_breve: null,
      }],
    });

    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.mainBalanceItems]).toContain('Costi per materie: N/D');
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.mainBalanceItems]).toContain('Debiti bancari a breve: N/D');
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.yearOverYear]).toContain('Non disponibile');
  });

  it('riconosce e commenta il bilancio provvisorio tramite il file collegato', () => {
    const provisional: CommercialBalanceRecord = {
      ...annual2025,
      id: 'provisional-2026',
      uploaded_file_id: 'provisional-file',
      anno_esercizio: 2026,
      ricavi_vendite: 700_000,
      totale_valore_produzione: 720_000,
      totale_costi_produzione: 650_000,
    };
    const result = buildCommercialReportAnalysis({
      balances: [provisional, annual2025, annual2024],
      provisionalFileIds: ['provisional-file'],
      hasProvisionalDocument: true,
    });

    expect(result.latestAnnual?.anno_esercizio).toBe(2025);
    expect(result.provisional?.anno_esercizio).toBe(2026);
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.provisionalBalance]).toContain('provvisorio');
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.provisionalBalance]).toContain('non viene applicata alcuna annualizzazione');
  });

  it('annualizza solo i flussi del provvisorio e mantiene puntuali le poste patrimoniali', () => {
    const provisional: CommercialBalanceRecord = {
      ...annual2025,
      uploaded_file_id: 'provisional-6m',
      anno_esercizio: 2026,
      periodo_inizio: '2026-01-01',
      periodo_fine: '2026-06-30',
      ricavi_vendite: 600_000,
      totale_valore_produzione: 620_000,
      totale_costi_produzione: 540_000,
      ammortamenti: 20_000,
      utile_netto: 50_000,
      totale_attivo: 950_000,
      totale_patrimonio_netto: 390_000,
      totale_debiti: 510_000,
      disponibilita_liquide: 130_000,
    };

    expect(getBalancePeriodMonths(provisional)).toBeCloseTo(6, 1);
    const annualized = annualizeBalanceFlows(provisional);
    expect(annualized?.ricavi_vendite).toBeCloseTo(1_200_000, 0);
    expect(annualized?.totale_valore_produzione).toBeCloseTo(1_240_000, 0);
    expect(annualized?.utile_netto).toBeCloseTo(100_000, 0);
    expect(annualized?.totale_attivo).toBe(950_000);
    expect(annualized?.totale_patrimonio_netto).toBe(390_000);

    const result = buildCommercialReportAnalysis({
      balances: [provisional, annual2025],
      provisionalFileIds: ['provisional-6m'],
      hasProvisionalDocument: true,
    });
    expect(result.provisionalMonths).toBeCloseTo(6, 1);
    expect(result.provisionalAnnualized?.ricavi_vendite).toBeCloseTo(1_200_000, 0);
    expect(result.financialEvolution).toContain('annualizzato sui flussi');
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.yearOverYear]).toContain('annualizzato sui flussi');
  });

  it('segnala il documento provvisorio caricato ma non ancora analizzato', () => {
    const result = buildCommercialReportAnalysis({
      balances: [annual2025],
      hasProvisionalDocument: true,
    });

    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.provisionalBalance]).toContain('caricato');
    expect(result.sections[COMMERCIAL_REPORT_SECTION_KEYS.provisionalBalance]).toContain('analisi strutturata');
  });
});
