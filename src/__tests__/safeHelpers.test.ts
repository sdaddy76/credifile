import { safeSection } from '@/lib/safeHelpers';

describe('safeSection', () => {
  it('ritorna stringa vuota per null', () => {
    expect(safeSection(null)).toBe('');
  });

  it('ritorna stringa vuota per undefined', () => {
    expect(safeSection(undefined)).toBe('');
  });

  it('ritorna il valore valido invariato', () => {
    expect(safeSection('valore valido')).toBe('valore valido');
  });

  it('gestisce 0 senza NaN o undefined', () => {
    const result = safeSection(0);

    expect(result).toBe('0');
    expect(result).not.toMatch(/NaN|undefined/i);
  });
});
