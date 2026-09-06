import { analyzeDocumentCoherence } from '@/lib/documentCoherence';

describe('documentCoherence', () => {
  it('non trasforma le fonti mancanti in anomalie', () => {
    const result = analyzeDocumentCoherence({
      client: { ragione_sociale: 'Alfa Srl' },
      practice: {},
      balances: [],
      financing: [],
      transactions: [],
    });

    expect(result.findings).toHaveLength(0);
    expect(result.checks.some(check => check.status === 'non_verificabile')).toBe(true);
  });

  it('rileva capitale e identità non allineati', () => {
    const result = analyzeDocumentCoherence({
      client: { ragione_sociale: 'Alfa Costruzioni Srl', capitale_sociale: 10000, codice_ateco: '41.20' },
      practice: { codice_ateco: '41.20' },
      balances: [{
        anno_esercizio: 2025,
        ragione_sociale: 'Beta Trasporti Spa',
        capitale_sociale: 50000,
      }],
      financing: [],
      transactions: [],
    });

    expect(result.findings.map(finding => finding.id)).toEqual(
      expect.arrayContaining(['identity_company_name', 'capital_share_capital'])
    );
  });

  it('considera equivalenti le forme societarie puntate', () => {
    const result = analyzeDocumentCoherence({
      client: { ragione_sociale: 'Alfa Costruzioni S.r.l.' },
      practice: {},
      balances: [{ anno_esercizio: 2025, ragione_sociale: 'ALFA COSTRUZIONI SRL' }],
      financing: [],
      transactions: [],
    });

    expect(result.findings.some(finding => finding.id === 'identity_company_name')).toBe(false);
  });

  it('confronta rate dichiarate e rate ricorrenti', () => {
    const result = analyzeDocumentCoherence({
      client: { ragione_sociale: 'Alfa Srl' },
      practice: {},
      balances: [],
      financing: [{
        fonte: 'manuale',
        banca_finanziaria: 'Banca Alfa',
        rata: 1500,
        debito_residuo: 80000,
      }],
      transactions: [
        { data_valuta: '2026-01-10', importo: 500, tipo: 'uscita', categoria: 'rata_finanziamento', descrizione: 'Rata Banca Alfa', classification_confidence: 'alta', parse_confidence: 'alta' },
        { data_valuta: '2026-02-10', importo: 500, tipo: 'uscita', categoria: 'rata_finanziamento', descrizione: 'Rata Banca Alfa', classification_confidence: 'alta', parse_confidence: 'alta' },
        { data_valuta: '2026-03-10', importo: 500, tipo: 'uscita', categoria: 'rata_finanziamento', descrizione: 'Rata Banca Alfa', classification_confidence: 'alta', parse_confidence: 'alta' },
      ],
    });

    expect(result.findings.some(finding => finding.id === 'financing_installments_vs_statement')).toBe(true);
  });
});
