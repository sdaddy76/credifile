import { parseLocalizedNumber } from '@/lib/numberParsing';
import { extractBankDebtByMaturity, parseItalianBalanceNumber } from '../../supabase/functions/_shared/balance-parser';

describe('number parsing', () => {
  it.each([
    ['1.234.567,89', 1_234_567.89],
    ['1,234,567.89', 1_234_567.89],
    ['1234.56', 1234.56],
    ['(1.234,50)', -1234.5],
    ['-', null],
    ['N/D', null],
  ])('interpreta %s senza trasformare i placeholder in zero', (raw, expected) => {
    expect(parseLocalizedNumber(raw)).toBe(expected);
  });

  it('mantiene il parser del bilancio coerente con il formato italiano', () => {
    expect(parseItalianBalanceNumber('1.234.567,89')).toBe(1_234_567.89);
  });

  it('separa debiti bancari a breve e medio-lungo solo con scadenza esplicita', () => {
    const text = [
      'Debiti verso banche',
      'entro 12 mesi 120.000,00',
      'oltre 12 mesi 380.000,00',
    ].join('\n');

    expect(extractBankDebtByMaturity(text, 'breve')).toBe(120_000);
    expect(extractBankDebtByMaturity(text, 'lungo')).toBe(380_000);
  });
});
