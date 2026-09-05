import {
  analyzeBalanceAnomalies,
  extractBalanceLineItems,
  inferAtecoSectorKey,
  type BalanceSnapshot,
} from '../../supabase/functions/_shared/balance-anomaly-engine';
import {
  BALANCE_VALUE_PATTERNS,
  extractBalanceValue,
  splitBalanceDocument,
} from '../../supabase/functions/_shared/balance-parser';

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
  totale_passivo: 1_000_000,
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

  it('non concatena colonne numeriche separate nelle righe della nota integrativa', () => {
    expect(extractBalanceLineItems(
      'Crediti verso altri iscritti nell’attivo circolante 141.617 118.927 260.544 260.544',
    )).toEqual([
      {
        label: 'Crediti verso altri iscritti nell’attivo circolante',
        current_value: 141_617,
        previous_value: 118_927,
      },
    ]);
  });

  it('distingue il totale attivo dal totale attivo circolante', () => {
    const text = [
      'Stato patrimoniale',
      'Attivo',
      'Totale attivo circolante (C) 1.916.705 1.232.512',
      'Totale attivo 2.126.798 1.442.605',
      'Passivo',
      'Totale passivo 2.126.798 1.442.605',
      'Conto economico',
    ].join('\n');
    const sections = splitBalanceDocument(text);

    expect(extractBalanceValue(sections.attivo, ['Totale attivo'])).toBe(2_126_798);
    expect(extractBalanceValue(sections.attivo, ['Totale attivo circolante (C)'])).toBe(1_916_705);
  });

  it('mantiene separate le voci dello stato patrimoniale e del conto economico', () => {
    const text = [
      'Stato patrimoniale',
      'Attivo',
      'II - Immobilizzazioni materiali 210.093 210.093',
      'Totale attivo 2.126.798 1.442.605',
      'Passivo',
      'C) Trattamento di fine rapporto di lavoro subordinato 46.322 5.066',
      'Totale passivo 2.126.798 1.442.605',
      'Conto economico',
      'a) ammortamento delle immobilizzazioni immateriali - 27.045',
      'b) ammortamento delle immobilizzazioni materiali 57.216 28.856',
    ].join('\n');
    const sections = splitBalanceDocument(text);

    expect(extractBalanceValue(sections.attivo, ['Immobilizzazioni immateriali'])).toBeNull();
    expect(extractBalanceValue(sections.contoEconomico, ['Ammortamento delle immobilizzazioni immateriali'])).toBe(0);
    expect(extractBalanceValue(sections.contoEconomico, ['Trattamento di fine rapporto'])).toBeNull();
  });

  it('legge la voce completa dei costi per materie prime dal bilancio XBRL PDF', () => {
    const text = [
      'Conto economico',
      'B) Costi della produzione',
      '6) per materie prime, sussidiarie, di consumo e di merci 3.915.657 3.495.876',
      '7) per servizi 769.360 595.794',
    ].join('\n');
    const sections = splitBalanceDocument(text);

    expect(extractBalanceValue(
      sections.contoEconomico,
      [...BALANCE_VALUE_PATTERNS.costiMaterie],
    )).toBe(3_915_657);
  });

  it('non segnala come costo materie zero un valore non estratto', () => {
    const result = analyzeBalanceAnomalies({
      current: { ...baseBalance, costi_materie: null },
      sectorKey: 'commercio',
    });

    expect(result.findings.some(item => item.id === 'materie-prime-atipiche-settore')).toBe(false);
  });

  it('usa il totale passivo dichiarato per verificare la quadratura', () => {
    const result = analyzeBalanceAnomalies({
      current: {
        ...baseBalance,
        totale_attivo: 2_126_798,
        totale_passivo: 2_126_798,
        totale_patrimonio_netto: 1_888_155,
        fondi_rischi: 3_258,
        tfr: 46_322,
        totale_debiti: 189_063,
      },
      sectorKey: 'commercio',
    });

    expect(result.findings.some(item => item.id === 'quadratura-stato-patrimoniale')).toBe(false);
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
    expect(result.validation_checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'quadratura-stato-patrimoniale',
        status: 'passed',
      }),
      expect.objectContaining({
        id: 'quadratura-risultato-operativo',
        status: 'passed',
      }),
      expect.objectContaining({
        id: 'quadratura-utile-netto',
        status: 'passed',
      }),
    ]));
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

  it('calcola separatamente l’attendibilità dell’estrazione', () => {
    const rawText = [
      'Stato patrimoniale',
      'Attivo',
      'Totale attivo 1.000.000 900.000',
      'Immobilizzazioni materiali 250.000 220.000',
      'Rimanenze 180.000 160.000',
      'Crediti 180.000 150.000',
      'Disponibilità liquide 120.000 110.000',
      'Passivo',
      'Totale patrimonio netto 300.000 280.000',
      'Totale debiti 640.000 580.000',
      'Totale passivo 1.000.000 900.000',
      'Conto economico',
      'Ricavi delle vendite 900.000 850.000',
      'Totale valore della produzione 1.000.000 950.000',
      'Totale costi della produzione 900.000 860.000',
      'Differenza tra valore e costi della produzione 100.000 90.000',
      'Utile (perdita) dell’esercizio 56.000 50.000',
    ].join('\n');
    const result = analyzeBalanceAnomalies({
      current: baseBalance,
      rawText,
      sectorKey: 'manifattura',
    });

    expect(result.data_quality_score).toBe(100);
    expect(result.data_quality_level).toBe('alta');
    expect(result.data_quality_notes).toEqual([]);
  });

  it('abbassa la qualità quando il testo non contiene sezioni o voci sufficienti', () => {
    const result = analyzeBalanceAnomalies({
      current: baseBalance,
      rawText: 'Totale attivo 1.000.000',
      sectorKey: 'manifattura',
    });

    expect(result.data_quality_level).toBe('bassa');
    expect(result.data_quality_score).toBeLessThan(55);
    expect(result.data_quality_notes).toEqual(expect.arrayContaining([
      expect.stringContaining('Stato patrimoniale'),
      expect.stringContaining('Conto economico'),
      expect.stringContaining('Sono state riconosciute solo'),
    ]));
  });

  it('riduce la forza degli alert quando la qualità dell’estrazione è bassa', () => {
    const result = analyzeBalanceAnomalies({
      current: { ...baseBalance, totale_attivo: 1_300_000 },
      rawText: 'Totale attivo 1.300.000',
      sectorKey: 'manifattura',
    });
    const finding = result.findings.find(item => item.id === 'quadratura-stato-patrimoniale');

    expect(result.data_quality_level).toBe('bassa');
    expect(finding?.severity).toBe('media');
    expect(finding?.confidence).toBe('bassa');
    expect(finding?.explanation).toContain('qualità dell’estrazione è bassa');
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
    expect(result.validation_checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'quadratura-stato-patrimoniale',
        status: 'unavailable',
      }),
    ]));
  });
});
