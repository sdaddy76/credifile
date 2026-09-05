import {
  classifyFinPromoterCompany,
  requirementApplies,
  type FinPromoterProfile,
} from '@/lib/finpromoterChecklist';

describe('checklist FinPromoter', () => {
  it.each([
    ['SPORT CAR RADIO S.R.L.', 'societa_capitali'],
    ['ESEMPIO S.P.A.', 'societa_capitali'],
    ['ALFA S.N.C.', 'societa_persone'],
    ['BETA S.A.S.', 'societa_persone'],
    ['DITTA INDIVIDUALE MARIO ROSSI', 'impresa_individuale'],
    ['COOPERATIVA SOCIALE FUTURO', 'cooperativa'],
  ] as const)('riconosce la tipologia da forma giuridica o ragione sociale: %s', (value, expected) => {
    expect(classifyFinPromoterCompany(value).tipo).toBe(expected);
  });

  it('tratta la cooperativa come società di capitali e richiede anche il libro soci', () => {
    const profile = classifyFinPromoterCompany('COOPERATIVA SOCIALE FUTURO');

    expect(requirementApplies({ condizione: 'societa_capitali' }, profile)).toBe(true);
    expect(requirementApplies({ condizione: 'cooperativa' }, profile)).toBe(true);
  });

  it('distingue contabilità ordinaria e semplificata per persone e imprese individuali', () => {
    const ordinaria = classifyFinPromoterCompany('ALFA S.N.C.', 'ordinaria');
    const semplificata = classifyFinPromoterCompany('DITTA INDIVIDUALE MARIO ROSSI', 'semplificata');

    expect(requirementApplies({ condizione: 'persone_ordinaria' }, ordinaria)).toBe(true);
    expect(requirementApplies({ condizione: 'persone_semplificata' }, ordinaria)).toBe(false);
    expect(requirementApplies({ condizione: 'persone_semplificata' }, semplificata)).toBe(true);
    expect(requirementApplies({ condizione: 'persone_ordinaria' }, semplificata)).toBe(false);
  });

  it('applica i documenti condizionati solo quando la condizione della pratica è attiva', () => {
    const base = classifyFinPromoterCompany('ESEMPIO S.R.L.');
    const profile: FinPromoterProfile = {
      ...base,
      condizioni: { ...base.condizioni, investimento: true, garante: true },
    };

    expect(requirementApplies({ condizione: 'investimento' }, profile)).toBe(true);
    expect(requirementApplies({ condizione: 'garante' }, profile)).toBe(true);
    expect(requirementApplies({ condizione: 'mediazione' }, profile)).toBe(false);
  });

  it('non applica la documentazione contabile condizionata senza regime', () => {
    const profile = classifyFinPromoterCompany('ALFA S.N.C.');

    expect(requirementApplies({ condizione: 'persone_ordinaria' }, profile)).toBe(false);
    expect(requirementApplies({ condizione: 'persone_semplificata' }, profile)).toBe(false);
  });
});
