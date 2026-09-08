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
});
