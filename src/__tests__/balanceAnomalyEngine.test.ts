import {
  analyzeBalanceAnomalies,
  extractBalanceLineItems,
  inferAtecoSectorKey,
  type BalanceSnapshot,
} from '../../supabase/functions/_shared/balance-anomaly-engine';

const baseBalance: BalanceSnapshot = {
  anno_esercizio: 2025,
  totale_attivo: 1_000_000,
  totale_immobilizzazioni: 300_000,
  imm_immateriali: 30_000,
  imm_materiali: 250_000,
  imm_finanziarie: 20_000,
  totale_attivo_circolante: 680_000,
  rimanenze: 180_000,
  crediti_circolante: 180_000,
  disponibilita_liquide: 120_000,
  ratei_risconti_attivi: 20_000,
  totale_patrimonio_netto: 300_000,
  capitale_sociale: 100_000,
  fondi_rischi: 20_000,
  tfr: 30_000,
  debiti_banche_breve: 120_000,
  debiti_banche_lungo: 0,
  debiti_altri_finanziatori: 30_000,
  debiti_fornitori: 250_000,
  debiti_tributari: 40_000,
  totale_debiti: 640_000,
  ratei_risconti_passivi: 10_000,
  ricavi_vendite: 900_000,
  totale_valore_produzione: 1_000_000,
  costi_materie: 400_000,
  costi_servizi: 220_000,
  costo_personale: 180_000,
  ammortamenti: 50_000,
  oneri_diversi_gestione: 20_000,
  totale_costi_produzione: 900_000,
  differenza_ab: 100_000,
  proventi_partecipazioni: 0,
  interessi_passivi: 20_000,
  risultato_ante_imposte: 80_000,
  imposte: 24_000,
  utile_netto: 56_000,
  utile_perdita_esercizio: 56_000,
  is_holding: false,
};

describe('balance anomaly engine', () => {
  it('riconosce il macrosettore dal codice ATECO', () => {
    expect(inferAtecoSectorKey('62.01.00')).toBe('ict');
    expect(inferAtecoSectorKey('25.11.00')).toBe('manifattura');
    expect(inferAtecoSectorKey('69.20.11')).toBe('professionali');
  });

  it('separa etichetta, valore corrente e valore precedente per ogni voce', () => {
    expect(extractBalanceLineItems('Altri crediti e partite diverse 180.000 45.000')).toEqual([
      {
        label: 'Altri crediti e partite diverse',
        current_value: 180_000,
        previous_value: 45_000,
      },
    ]);
  });

  it('non genera red flag rilevanti per un bilancio coerente', () => {
    const result = analyzeBalanceAnomalies({
      current: baseBalance,
      atecoCode: '25.11.00',
      sectorKey: 'manifattura',
      benchmark: { DSO: 85, 'EBITDA Margin': 9, ROS: 4, ROE: 8 },
    });

    expect(result.findings).toHaveLength(0);
    expect(result.score).toBe(0);
    expect(result.level).toBe('basso');
  });

  it('segnala uno stato patrimoniale non quadrato con confidenza alta', () => {
    const result = analyzeBalanceAnomalies({
      current: { ...baseBalance, totale_attivo: 1_300_000 },
      sectorKey: 'manifattura',
    });

    const finding = result.findings.find(item => item.id === 'quadratura-stato-patrimoniale');
    expect(finding?.severity).toBe('alta');
    expect(finding?.confidence).toBe('alta');
  });

  it('segnala un utile netto non riconciliato', () => {
    const result = analyzeBalanceAnomalies({
      current: { ...baseBalance, utile_netto: 140_000, utile_perdita_esercizio: 140_000 },
      sectorKey: 'manifattura',
    });

    expect(result.findings.some(item => item.id === 'quadratura-utile-netto')).toBe(true);
  });

  it('individua crediti cresciuti molto più dei ricavi', () => {
    const previous: BalanceSnapshot = {
      ...baseBalance,
      anno_esercizio: 2024,
      crediti_circolante: 80_000,
      ricavi_vendite: 850_000,
      totale_valore_produzione: 950_000,
    };
    const result = analyzeBalanceAnomalies({
      current: baseBalance,
      previous,
      sectorKey: 'manifattura',
    });

    expect(result.findings.some(item => item.id === 'crediti-piu-rapidi-ricavi')).toBe(true);
  });

  it('individua rimanenze atipiche nei servizi professionali', () => {
    const result = analyzeBalanceAnomalies({
      current: { ...baseBalance, rimanenze: 300_000 },
      atecoCode: '69.20.11',
      sectorKey: 'professionali',
    });

    expect(result.findings.some(item => item.id === 'rimanenze-atipiche-settore')).toBe(true);
  });

  it('individua costo materie assente in manifattura', () => {
    const result = analyzeBalanceAnomalies({
      current: { ...baseBalance, costi_materie: 0 },
      sectorKey: 'manifattura',
    });

    expect(result.findings.some(item => item.id === 'materie-prime-atipiche-settore')).toBe(true);
  });

  it('tratta una redditività eccezionale come verifica a bassa confidenza', () => {
    const result = analyzeBalanceAnomalies({
      current: {
        ...baseBalance,
        totale_valore_produzione: 1_000_000,
        totale_costi_produzione: 600_000,
        differenza_ab: 400_000,
        ammortamenti: 30_000,
      },
      sectorKey: 'manifattura',
      benchmark: { 'EBITDA Margin': 9, ROS: 4 },
    });

    const finding = result.findings.find(item => item.id.includes('margine-insolitamente-alto'));
    expect(finding?.confidence).toBe('bassa');
    expect(finding?.severity).toBe('bassa');
  });

  it('segnala una posta generica materialmente rilevante', () => {
    const result = analyzeBalanceAnomalies({
      current: baseBalance,
      rawText: 'Dettaglio crediti\nAltri crediti 150.000\nTotale crediti 380.000',
      sectorKey: 'manifattura',
    });

    const finding = result.findings.find(item => item.id === 'posta-generica-altri-crediti');
    expect(finding).toBeDefined();
    expect(finding?.suggested_question.toLowerCase()).toContain('altri crediti');
    expect(result.line_items_analyzed).toBeGreaterThan(0);
    expect(result.line_items_flagged).toBe(1);
  });

  it('classifica i dati insufficienti come problema di qualità senza formulare accuse', () => {
    const result = analyzeBalanceAnomalies({
      current: { anno_esercizio: 2025, totale_attivo: 100_000 },
      sectorKey: 'default',
    });

    const finding = result.findings.find(item => item.id === 'qualita-dati-principali');
    expect(finding?.category).toBe('qualita_dato');
    expect(result.disclaimer.toLowerCase()).toContain('anomalie di bilancio da approfondire');
    expect(result.disclaimer.toLowerCase()).not.toContain('frode');
  });
});
