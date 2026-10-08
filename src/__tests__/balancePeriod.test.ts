import {
  financingForBalanceYear,
  transactionsForBalanceYear,
} from '../../supabase/functions/_shared/balance-period';

describe('period filtering for balance analysis', () => {
  it('uses only bank-statement transactions from the analyzed fiscal year', () => {
    const rows = [
      { data_valuta: '2025-01-15', importo: 500 },
      { data_valuta: '2026-01-15', importo: 900 },
      { data_valuta: null, data_contabile: '2025-12-20', importo: 200 },
      { data_valuta: null, data_contabile: null, importo: 100 },
    ];

    expect(transactionsForBalanceYear(rows, 2025)).toEqual([rows[0], rows[2]]);
  });

  it('excludes financing snapshots explicitly dated after the analyzed year', () => {
    const rows = [
      { data_riferimento: '30/06/2025', rata: 100 },
      { data_riferimento: '30/06/2026', rata: 200 },
      { data_riferimento: null, rata: 300 },
    ];

    expect(financingForBalanceYear(rows, 2025, 2026)).toEqual([rows[0]]);
    expect(financingForBalanceYear(rows, 2026, 2026)).toEqual(rows);
  });
});
