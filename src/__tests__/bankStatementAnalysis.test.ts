import { analyzeBankStatement, normalizeCounterparty } from '@/lib/bankStatementAnalysis';

describe('bankStatementAnalysis', () => {
  it('riconosce rate ricorrenti e saldi negativi', () => {
    const result = analyzeBankStatement([
      { data_valuta: '2026-01-10', importo: 500, tipo: 'uscita', categoria: 'rata_finanziamento', descrizione: 'Rata finanziamento Banca Alfa 001', saldo_progressivo: 1000, classification_confidence: 'alta', parse_confidence: 'alta' },
      { data_valuta: '2026-02-10', importo: 505, tipo: 'uscita', categoria: 'rata_finanziamento', descrizione: 'Rata finanziamento Banca Alfa 002', saldo_progressivo: -250, classification_confidence: 'alta', parse_confidence: 'alta' },
      { data_valuta: '2026-03-10', importo: 500, tipo: 'uscita', categoria: 'rata_finanziamento', descrizione: 'Rata finanziamento Banca Alfa 003', saldo_progressivo: 200, classification_confidence: 'alta', parse_confidence: 'alta' },
    ]);

    expect(result.monthsAnalyzed).toBe(3);
    expect(result.recurringFinancingPayments).toHaveLength(1);
    expect(result.recurringFinancingPayments[0].averageAmount).toBeCloseTo(501.67, 1);
    expect(result.negativeBalanceObservations).toBe(1);
    expect(result.insights.some(insight => insight.id === 'negative_balances')).toBe(true);
  });

  it('segnala una copertura di lettura insufficiente', () => {
    const result = analyzeBankStatement([
      { data_valuta: '2026-01-01', importo: 100, tipo: 'entrata', categoria: 'altro_entrata', descrizione: 'Movimento 1', classification_confidence: 'bassa', parse_confidence: 'bassa' },
      { data_valuta: '2026-01-02', importo: 100, tipo: 'uscita', categoria: 'altro_uscita', descrizione: 'Movimento 2', classification_confidence: 'bassa', parse_confidence: 'media' },
      { data_valuta: '2026-01-03', importo: 100, tipo: 'entrata', categoria: 'incasso_cliente', descrizione: 'Cliente', classification_confidence: 'alta', parse_confidence: 'alta' },
    ]);

    expect(result.reliablePercentage).toBeCloseTo(33.3, 1);
    expect(result.insights.some(insight => insight.id === 'data_quality')).toBe(true);
  });

  it('normalizza le controparti rimuovendo numeri e causali tecniche', () => {
    expect(normalizeCounterparty('ADDEBITO RATA BANCA ALFA N. 001234')).toBe('banca alfa');
  });
});
