import {
  KPI_SCORING_CONFIG,
  buildBankabilityAssessment,
  calculateKpiScore,
  type KpiResult,
} from '@/lib/bankabilityScoring';

function entry(value: number, formatted = String(value)) {
  return { valore: value, formatted, semaforo: 'verde', label: '' };
}

const completeKpi: KpiResult = {
  copertura: {
    dscr: entry(1.25, '1.25x'),
    interest_coverage: entry(3, '3.00x'),
  },
  indebitamento: {
    pfn_ebitda: entry(3, '3.0x'),
    pfn_pn: entry(1, '1.00'),
  },
  redditivita: {
    ebitda_margin: entry(15, '15.0%'),
    roe: entry(10, '10.0%'),
    roi: entry(8, '8.0%'),
    ros: entry(8, '8.0%'),
  },
  liquidita: {
    current_ratio: entry(1.5, '1.50'),
    quick_ratio: entry(1, '1.00'),
  },
  solidita: {
    leverage: entry(2.5, '2.50'),
    debt_equity: entry(1.5, '1.50'),
    pn_su_ta: entry(40, '40.0%'),
  },
  efficienza: {
    dso: entry(60, '60 gg'),
  },
};

describe('bankability scoring a 14 KPI', () => {
  it('usa esattamente 14 KPI con pesi complessivi pari a 100', () => {
    expect(KPI_SCORING_CONFIG).toHaveLength(14);
    expect(KPI_SCORING_CONFIG.reduce((sum, config) => sum + config.peso, 0)).toBe(100);
  });

  it('assegna 100 alle soglie ottimali e produce indice 100', () => {
    const assessment = buildBankabilityAssessment(completeKpi);

    expect(assessment.availableCount).toBe(14);
    expect(assessment.totalCount).toBe(14);
    expect(assessment.scores.every(score => score.score === 100)).toBe(true);
    expect(assessment.indice).toBe(100);
    expect(assessment.rating).toBe('bancabile');
  });

  it('normalizza l’indice sui soli KPI disponibili senza generare NaN', () => {
    const assessment = buildBankabilityAssessment({
      copertura: { dscr: entry(1, '1.00x') },
    });

    expect(assessment.availableCount).toBe(1);
    expect(assessment.indice).toBe(55);
    expect(Number.isNaN(assessment.indice)).toBe(false);
    expect(assessment.rating).toBe('attenzione');
  });

  it('gestisce correttamente KPI inversi come PFN/EBITDA', () => {
    expect(calculateKpiScore(3, 3, 5, 7, true)).toBe(100);
    expect(calculateKpiScore(5, 3, 5, 7, true)).toBe(55);
    expect(calculateKpiScore(7, 3, 5, 7, true)).toBe(0);
  });
});
