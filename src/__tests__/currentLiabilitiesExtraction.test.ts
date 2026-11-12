import { extractCurrentLiabilities } from '../../supabase/functions/_shared/balance-parser';
import { calculateProbabilityOfDefault } from '@/lib/probabilityOfDefault';

const civil = (debt: string) => `
## Stato patrimoniale
Attivo
Totale attivo circolante 500.000 400.000
Totale attivo 1.000.000 900.000
Passivo
Totale patrimonio netto 300.000 250.000
${debt}
E) Ratei e risconti 10.000 9.000
Totale passivo 1.000.000 900.000
## Conto economico
Utile dell'esercizio 50.000 40.000
`;

describe('current liabilities extraction from real-world Italian layouts', () => {
  it.each(['Passività correnti', 'Totale passivita correnti', 'Passivo corrente', 'Totale passività a breve'])('recognises the reclassified total: %s', label => {
    const result = extractCurrentLiabilities(civil(`${label} 200.000 180.000`));
    expect(result.value).toBe(200_000);
    expect(result.source).toBe('explicit');
  });
  it('reads a markdown table with decimals and takes only the current-year column', () => {
    expect(extractCurrentLiabilities(civil('| Totale passività correnti | 200.000,50 | 180.000,25 |')).value).toBe(200_000.5);
  });
  it('recognises amounts on a separate PDF line without scanning across other labels', () => {
    expect(extractCurrentLiabilities(civil('Totale passività correnti\n200.000 180.000')).value).toBe(200_000);
    expect(extractCurrentLiabilities(civil("D) Debiti\nesigibili entro l’esercizio successivo\n200.000 180.000\nTotale debiti 690.000 641.000")).value).toBe(200_000);
    expect(extractCurrentLiabilities(civil('Totale passività correnti\nTotale patrimonio netto 300.000')).value).toBeNull();
  });
  it.each(["l'esercizio successivo", 'l’esercizio successivo', '12 mesi', 'i 12 mesi'])('reads the abbreviated D) Debiti maturity: %s', period => {
    const result = extractCurrentLiabilities(civil(`D) Debiti
esigibili entro ${period} 200.000 180.000
esigibili oltre l'esercizio successivo 490.000 461.000
Totale debiti 690.000 641.000`));
    expect(result.value).toBe(200_000);
    expect(result.source).toBe('short_debt_proxy');
    expect(result.note).toContain('PROXY');
    expect(result.note).toContain('non sono inclusi');
  });
  it('recognises a labelled total without confusing it with a bank line', () => {
    const result = extractCurrentLiabilities(civil(`Debiti verso banche entro 12 mesi 50.000
Totale debiti esigibili entro 12 mesi 200.000`));
    expect(result.value).toBe(200_000);
  });
  it('sums unique creditor categories, verifying their totals against Totale debiti', () => {
    const result = extractCurrentLiabilities(civil(`D) Debiti
4) debiti verso banche 500.000 450.000
esigibili entro l'esercizio successivo 100.000 90.000
esigibili oltre l'esercizio successivo 400.000 360.000
7) debiti verso fornitori 190.000 191.000
esigibili entro l'esercizio successivo 190.000 191.000
12) debiti tributari 0 0
Totale debiti 690.000 641.000`));
    expect(result.value).toBe(290_000);
    expect(result.note).toContain('somma');
  });
  it('accepts creditor totals derivable from explicit short and long portions', () => {
    expect(extractCurrentLiabilities(civil(`D) Debiti
4) debiti verso banche
entro 12 mesi 100.000
oltre 12 mesi 400.000
7) debiti verso fornitori
entro 12 mesi 190.000
oltre 12 mesi 0
Totale debiti 690.000`)).value).toBe(290_000);
  });
  it('includes bonds and other numbered creditor categories, not only those named Debiti', () => {
    expect(extractCurrentLiabilities(civil(`D) Debiti
1) obbligazioni 500.000
entro 12 mesi 100.000
oltre 12 mesi 400.000
7) debiti verso fornitori 190.000
entro 12 mesi 190.000
Totale debiti 690.000`)).value).toBe(290_000);
  });
  it.each([
    'D) Debiti\nTotale debiti 690.000',
    'Debiti verso banche entro 12 mesi 100.000',
    'D) Debiti\n4) debiti verso banche 500.000\nentro 12 mesi 100.000\n7) debiti verso fornitori 190.000\nTotale debiti 690.000',
    'D) Debiti\n4) debiti verso banche 500.000\nentro 12 mesi 100.000\nTotale debiti 690.000',
    'D) Debiti\nentro 12 mesi 700.000\nTotale debiti 690.000',
    'D) Debiti\nentro 12 mesi 200.000',
    'D) Debiti\nentro 12 mesi 200.000\nentro 12 mesi 200.000\nTotale debiti 690.000',
    'D) Debiti\n4) debiti verso banche 500.000\nentro 12 mesi 100.000\n4) debiti verso banche 500.000\nentro 12 mesi 100.000\nTotale debiti 1.000.000',
  ])('does not invent data in an incomplete or ambiguous block: %s', debt => {
    expect(extractCurrentLiabilities(civil(debt)).value).toBeNull();
  });
  it('does not use asset maturities or figures in the notes as liabilities', () => {
    const text = civil('D) Debiti\nTotale debiti 690.000')
      .replace('Totale attivo circolante', 'Crediti entro 12 mesi 999.000\nTotale attivo circolante')
      + '\nNota integrativa\nTotale passività correnti 777.000';
    expect(extractCurrentLiabilities(text).value).toBeNull();
    expect(extractCurrentLiabilities(text.replace('## Conto economico', '')).value).toBeNull();
  });
  it('rejects a labelled short-debt total larger than all debts', () => {
    expect(extractCurrentLiabilities(civil('Totale debiti esigibili entro 12 mesi 800.000\nTotale debiti 690.000')).value).toBeNull();
  });
  it('preserves explicit zero but rejects negative liabilities', () => {
    expect(extractCurrentLiabilities(civil('Passività correnti 0')).value).toBe(0);
    expect(extractCurrentLiabilities(civil('Passività correnti (200.000)')).value).toBeNull();
  });
  it('makes the formerly missing PD calculable while prominently retaining proxy provenance', () => {
    const extraction = extractCurrentLiabilities(civil(`D) Debiti
entro 12 mesi 200.000
oltre 12 mesi 490.000
Totale debiti 690.000`));
    const base = { totale_attivo: 1_000_000, totale_patrimonio_netto: 300_000, utile_netto: 50_000, totale_attivo_circolante: 500_000 };
    expect(calculateProbabilityOfDefault(base).status).toBe('unavailable');
    const result = calculateProbabilityOfDefault({ ...base, passivita_correnti: extraction.value,
      kpi: { liquidita: { current_ratio: { source_note: extraction.note } } },
    }, '46.90');
    expect(result.status).toBe('estimated');
    if (result.status === 'estimated') {
      expect(result.warnings.join(' ')).toContain('PROXY');
      expect(result.ratios.currentRatio).toBe(2.5);
    }
  });
});
