import {
  calculateProbabilityOfDefault, formatDefaultProbability, standardNormalCdf,
  type DefaultProbabilityInput,
} from '@/lib/probabilityOfDefault';

const balance: DefaultProbabilityInput = {
  totale_attivo: 1_000_000, totale_patrimonio_netto: 300_000,
  utile_netto: 50_000, totale_attivo_circolante: 400_000,
  passivita_correnti: 200_000, totale_debiti: 600_000,
  data_quality_level: 'alta',
};
const estimate = (overrides: DefaultProbabilityInput = {}) => {
  const result = calculateProbabilityOfDefault({ ...balance, ...overrides }, '46.90');
  if (result.status !== 'estimated') throw new Error(result.reasons.join('; '));
  return result;
};

describe('normal CDF (probit, not logistic)', () => {
  it.each([
    [0, 0.5], [1, 0.8413447460685429], [-1, 0.15865525393145707],
    [1.96, 0.9750021048517795], [-3, 0.0013498980316301],
  ])('Phi(%s) = %s', (x, expected) => {
    expect(standardNormalCdf(x)).toBeCloseTo(expected, 6);
  });
  it('handles tails and invalid arguments', () => {
    expect(standardNormalCdf(-Infinity)).toBe(0);
    expect(standardNormalCdf(Infinity)).toBe(1);
    expect(standardNormalCdf(NaN)).toBeNaN();
    expect(standardNormalCdf(-8)).toBeGreaterThan(0);
  });
});

describe('indicative PD, rounded Zmijewski model', () => {
  it('uses net income, full liabilities and unscaled ratios, with reproducible calculation', () => {
    const result = estimate();
    expect(result.ratios).toEqual({ roa: 0.05, leverage: 0.7, currentRatio: 2 });
    expect(result.amounts.totalLiabilities).toBe(700_000);
    expect(result.score).toBeCloseTo(-0.543, 12);
    // Independent reference: 0.5 * (1 + erf(-0.543 / sqrt(2))).
    expect(result.probability).toBeCloseTo(0.2935649007, 6);
  });
  it('does not confuse only debts with full liabilities', () => {
    expect(estimate({ totale_debiti: 400_000 }).probability).toBe(estimate().probability);
    expect(estimate({ totale_debiti: null }).probability).toBe(estimate().probability);
  });
  it('increases risk with losses and leverage, decreases with liquidity', () => {
    const baseline = estimate().probability;
    expect(estimate({ utile_netto: -50_000 }).probability).toBeGreaterThan(baseline);
    expect(estimate({ totale_patrimonio_netto: 200_000 }).probability).toBeGreaterThan(baseline);
    expect(estimate({ totale_attivo_circolante: 500_000 }).probability).toBeLessThan(baseline);
  });
  it('accepts real zeros, negative equity and negative earnings', () => {
    expect(estimate({ utile_netto: 0, totale_attivo_circolante: 0 }).status).toBe('estimated');
    const result = estimate({ totale_patrimonio_netto: -100_000, utile_netto: -100_000 });
    expect(result.ratios.leverage).toBe(1.1);
    expect(result.warnings.join(' ')).toMatch(/Patrimonio netto negativo/);
  });
  it.each([
    'totale_attivo', 'totale_patrimonio_netto', 'utile_netto',
    'totale_attivo_circolante', 'passivita_correnti',
  ] as const)('never replaces missing/invalid %s with zero', key => {
    for (const value of [null, undefined, NaN, Infinity, -Infinity, '1000']) {
      const result = calculateProbabilityOfDefault({ ...balance, [key]: value });
      expect(result.status).toBe('unavailable');
    }
    expect(calculateProbabilityOfDefault({ ...balance, voci_mancanti: [key] }).status).toBe('unavailable');
  });
  it.each([
    { totale_attivo: 0 }, { totale_attivo: -100 }, { passivita_correnti: 0 },
    { passivita_correnti: -100 }, { totale_attivo_circolante: -1 },
    { totale_attivo_circolante: 1_100_000 }, { totale_patrimonio_netto: 1_100_000 },
    { passivita_correnti: 800_000 }, { totale_debiti: 800_000 }, { totale_debiti: -1 },
    { totale_attivo: Number.MIN_VALUE, totale_patrimonio_netto: 0, totale_attivo_circolante: 0, passivita_correnti: Number.MIN_VALUE, totale_debiti: null },
  ])('rejects inconsistent/overflowing accounts: %o', overrides => {
    expect(calculateProbabilityOfDefault({ ...balance, ...overrides }).status).toBe('unavailable');
  });
  it.each([
    { is_holding: true }, { is_provvisorio: true }, { mesi_coperti: 6 }, { mesi_coperti: 18 },
    { data_quality_level: 'bassa' as const },
    { anomaly_analysis: { data_quality_level: 'bassa' as const } },
  ])('does not estimate when scope or extraction is unsuitable: %o', overrides => {
    expect(calculateProbabilityOfDefault({ ...balance, ...overrides }).status).toBe('unavailable');
  });
  it.each(['64.19', ' 65.11', '66.22'])('excludes financial/insurance companies (%s)', ateco => {
    expect(calculateProbabilityOfDefault(balance, ateco).status).toBe('unavailable');
  });
  it('warns on absent sector and unverified extraction, without claiming calibration', () => {
    const result = calculateProbabilityOfDefault({ ...balance, data_quality_level: undefined });
    expect(result.status).toBe('estimated');
    if (result.status === 'estimated') expect(result.warnings).toHaveLength(2);
    expect(estimate().warnings).toEqual([]);
  });
  it('uses each balance separately, without leaking values between years', () => {
    const before = estimate().probability;
    expect(calculateProbabilityOfDefault({ ...balance, passivita_correnti: null }).status).toBe('unavailable');
    expect(estimate().probability).toBe(before);
    expect(balance.passivita_correnti).toBe(200_000);
  });
});

describe('PD display', () => {
  it('uses Italian decimals without presenting false certainty at the tails', () => {
    expect(formatDefaultProbability(0.125)).toBe('12,50%');
    expect(formatDefaultProbability(0)).toBe('< 0,01%');
    expect(formatDefaultProbability(1)).toBe('> 99,99%');
    expect(formatDefaultProbability(NaN)).toBe('N/D');
    expect(formatDefaultProbability(-1)).toBe('N/D');
  });
});
