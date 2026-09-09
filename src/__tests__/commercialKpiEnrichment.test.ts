import { enrichCommercialKpis } from '@/lib/commercialKpiEnrichment';

describe('commercialKpiEnrichment', () => {
  it('ricostruisce i KPI di Sport Car Radio senza inventare il DSCR', () => {
    const result = enrichCommercialKpis({
      totale_attivo: 3_500_423,
      totale_patrimonio_netto: 2_189_076,
      totale_valore_produzione: 5_686_826,
      totale_costi_produzione: 4_824_185,
      ricavi_vendite: 5_230_790,
      differenza_ab: null,
      risultato_ante_imposte: null,
      interessi_passivi: 28_738,
      proventi_partecipazioni: null,
      ammortamenti: 121_127,
      disponibilita_liquide: 534_495,
      debiti_banche_breve: 0,
      debiti_banche_lungo: 0,
      debiti_altri_finanziatori: 0,
      voci_mancanti: null,
      kpi: {},
    }, [
      { debito_residuo: 482_000, rata: null, fonte: 'manuale' },
      { debito_residuo: 32_000, rata: null, fonte: 'manuale' },
      { debito_residuo: 396_000, rata: null, fonte: 'manuale' },
    ]);

    expect(result.kpi.redditivita.roi.valore).toBeCloseTo(24.64, 2);
    expect(result.kpi.redditivita.ros.valore).toBeCloseTo(15.17, 2);
    expect(result.kpi.redditivita.ebitda_margin.valore).toBeCloseTo(17.30, 2);
    expect(result.kpi.indebitamento.pfn_ebitda.valore).toBeCloseTo(0.38, 2);
    expect(result.kpi.copertura.interest_coverage.valore).toBeCloseTo(30.02, 2);
    expect(result.kpi.copertura.dscr.valore).toBeNull();
    expect(result.kpi.copertura.dscr.source).toBe('Non disponibile');
    expect(result.dscrSource).toBe('non_disponibile');
    expect(result.servizioDebitoAnnuo).toBeNull();
  });

  it('calcola il DSCR solo quando tutte le rate dei finanziamenti attivi sono disponibili', () => {
    const balance = {
      totale_attivo: 1_000_000,
      totale_patrimonio_netto: 400_000,
      totale_valore_produzione: 1_000_000,
      totale_costi_produzione: 900_000,
      ammortamenti: 20_000,
      disponibilita_liquide: 50_000,
      kpi: {},
    };

    const incomplete = enrichCommercialKpis(balance, [
      { debito_residuo: 100_000, rata: 1_000, fonte: 'manuale' },
      { debito_residuo: 50_000, rata: null, fonte: 'manuale' },
    ]);
    expect(incomplete.kpi.copertura.dscr.valore).toBeNull();

    const complete = enrichCommercialKpis(balance, [
      { debito_residuo: 100_000, rata: 1_000, fonte: 'manuale' },
      { debito_residuo: 50_000, rata: 500, fonte: 'manuale' },
    ]);
    expect(complete.kpi.copertura.dscr.valore).toBeCloseTo(6.67, 2);
    expect(complete.dscrSource).toBe('finanziamenti');
    expect(complete.servizioDebitoAnnuo).toBe(18_000);
  });

  it('ricalcola i 14 KPI con denominatori coerenti e non usa il totale debiti per la liquidità', () => {
    const result = enrichCommercialKpis({
      totale_attivo: 1_000_000,
      totale_attivo_circolante: 400_000,
      passivita_correnti: 200_000,
      rimanenze: 100_000,
      crediti_circolante: 180_000,
      totale_debiti: 500_000,
      totale_patrimonio_netto: 500_000,
      totale_valore_produzione: 1_000_000,
      totale_costi_produzione: 900_000,
      differenza_ab: 100_000,
      ammortamenti: 20_000,
      ricavi_vendite: 900_000,
      utile_netto: 80_000,
      costi_materie: 365_000,
      debiti_fornitori: 36_500,
      disponibilita_liquide: 100_000,
      debiti_banche_breve: 100_000,
      debiti_banche_lungo: 100_000,
      kpi: {},
    });

    expect(result.kpi.liquidita.current_ratio.valore).toBeCloseTo(2, 5);
    expect(result.kpi.liquidita.quick_ratio.valore).toBeCloseTo(1.5, 5);
    expect(result.kpi.liquidita.acid_test.valore).toBeCloseTo(0.5, 5);
    expect(result.kpi.solidita.debt_equity.valore).toBeCloseTo(1, 5);
    expect(result.kpi.solidita.leverage.valore).toBeCloseTo(2, 5);
    expect(result.kpi.solidita.pn_su_ta.valore).toBeCloseTo(50, 5);
    expect(result.kpi.redditivita.roe.valore).toBeCloseTo(16, 5);
    expect(result.kpi.efficienza.dso.valore).toBeCloseTo(73, 0);
    expect(result.kpi.efficienza.dpo.valore).toBeCloseTo(36.5, 0);
    expect(result.kpi.efficienza.dsi.valore).toBeCloseTo(100, 0);
  });

  it('lascia non disponibili i ratio di liquidità quando mancano le passività correnti', () => {
    const result = enrichCommercialKpis({
      totale_attivo_circolante: 300_000,
      totale_debiti: 100_000,
      rimanenze: 20_000,
      disponibilita_liquide: 50_000,
      kpi: {
        liquidita: {
          current_ratio: { valore: 3, formatted: '3.00', semaforo: 'verde', label: 'Current Ratio' },
        },
      },
    });
    expect(result.kpi.liquidita.current_ratio.valore).toBeNull();
    expect(result.kpi.liquidita.current_ratio.source_note).toContain('totale debiti');
  });
});
