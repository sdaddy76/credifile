/**
 * Indicative financial-distress proxy, NOT a calibrated regulatory PD.
 * Rounded Zmijewski specification reproduced in Viciwati (2020), pp. 797:
 * https://dinastipub.org/DIJEFA/article/download/608/389/1129
 * X = -4.3 - 4.5 NI/TA + 5.7 TL/TA - .004 CA/CL; P = Phi(X).
 * No local calibration, forecast horizon or bank rating is inferred.
 */
export const PD_MODEL = {
  version: 'zmijewski-rounded-probit-v1',
  name: 'Zmijewski (1984) · coefficienti arrotondati',
  formula: 'X = −4,3 − 4,5 × ROA + 5,7 × L − 0,004 × CR',
  sourceUrl: 'https://dinastipub.org/DIJEFA/article/download/608/389/1129',
  limitation: 'Proxy indicativa di dissesto da un modello storico statunitense, non calibrata sulle PMI italiane. Non è una PD bancaria ufficiale né una previsione validata a 12 mesi e non sostituisce il giudizio creditizio.',
} as const;

export interface DefaultProbabilityInput {
  totale_attivo?: number | null;
  totale_patrimonio_netto?: number | null;
  utile_netto?: number | null;
  totale_attivo_circolante?: number | null;
  passivita_correnti?: number | null;
  totale_debiti?: number | null;
  is_holding?: boolean | null;
  is_provvisorio?: boolean | null;
  mesi_coperti?: number | null;
  voci_mancanti?: string[] | null;
  data_quality_level?: 'alta' | 'media' | 'bassa';
  anomaly_analysis?: { data_quality_level?: 'alta' | 'media' | 'bassa' } | null;
  kpi?: { liquidita?: { current_ratio?: { source?: string; source_note?: string } } };
}

export type DefaultProbabilityResult = {
  status: 'unavailable';
  reasons: string[];
} | {
  status: 'estimated';
  probability: number;
  score: number;
  ratios: { roa: number; leverage: number; currentRatio: number };
  amounts: {
    totalAssets: number;
    equity: number;
    netIncome: number;
    totalLiabilities: number;
    currentAssets: number;
    currentLiabilities: number;
  };
  warnings: string[];
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Normal CDF (A&S 26.2.17, absolute error < 7.5e-8). Stable lower tail. */
export function standardNormalCdf(value: number): number {
  if (Number.isNaN(value)) return NaN;
  if (value === 0) return 0.5;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * x);
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)
    * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
      + t * (-1.821255978 + t * 1.330274429))));
  return Math.max(0, Math.min(1, value < 0 ? tail : 1 - tail));
}

export function calculateProbabilityOfDefault(
  input: DefaultProbabilityInput,
  codiceAteco?: string | null,
): DefaultProbabilityResult {
  const reasons: string[] = [];
  if (input.is_holding) reasons.push('Modello non applicato alle holding: serve una valutazione specifica delle partecipazioni.');
  if (/^(64|65|66)/.test(codiceAteco?.trim() ?? '')) {
    reasons.push('Modello non applicato al settore finanziario/assicurativo (ATECO 64–66).');
  }
  if (input.is_provvisorio || (finite(input.mesi_coperti)
    && (input.mesi_coperti < 11.5 || input.mesi_coperti > 12.5))) {
    reasons.push('Serve un bilancio annuale definitivo: i dati infrannuali o provvisori non vengono annualizzati automaticamente.');
  }
  const quality = input.anomaly_analysis?.data_quality_level ?? input.data_quality_level;
  if (quality === 'bassa') reasons.push('Attendibilità dell’estrazione bassa: verificare i dati del bilancio prima del calcolo.');

  const required = [
    ['totale_attivo', 'Totale attivo', input.totale_attivo],
    ['totale_patrimonio_netto', 'Patrimonio netto', input.totale_patrimonio_netto],
    ['utile_netto', 'Utile/perdita netta', input.utile_netto],
    ['totale_attivo_circolante', 'Attivo circolante', input.totale_attivo_circolante],
    ['passivita_correnti', 'Passività correnti', input.passivita_correnti],
  ] as const;
  for (const [key, label, value] of required) {
    if (!finite(value) || input.voci_mancanti?.includes(key)) {
      reasons.push(`${label}: dato mancante, non valido o segnalato come non estratto.`);
    }
  }
  if (reasons.length) return { status: 'unavailable', reasons };

  // Required values have been checked above; no missing values become zero.
  const totalAssets = input.totale_attivo!;
  const equity = input.totale_patrimonio_netto!;
  const netIncome = input.utile_netto!;
  const currentAssets = input.totale_attivo_circolante!;
  const currentLiabilities = input.passivita_correnti!;
  // Total liabilities include funds, TFR and accruals, not only "Totale debiti".
  const totalLiabilities = totalAssets - equity;
  if (totalAssets <= 0) reasons.push('Il totale attivo deve essere maggiore di zero.');
  if (currentLiabilities <= 0) reasons.push('Le passività correnti devono essere maggiori di zero per calcolare il Current Ratio.');
  if (currentAssets < 0) reasons.push('L’attivo circolante non può essere negativo.');
  if (totalLiabilities < 0) reasons.push('Patrimonio netto superiore al totale attivo: passività ricostruite negative.');
  // Allow one euro of rounding in independently extracted accounting totals.
  if (currentAssets > totalAssets + 1) reasons.push('Attivo circolante superiore al totale attivo: verificare l’estrazione.');
  if (currentLiabilities > totalLiabilities + 1) reasons.push('Passività correnti superiori alle passività totali: verificare l’estrazione.');
  if (finite(input.totale_debiti)
    && (input.totale_debiti < 0 || input.totale_debiti > totalLiabilities + 1)) {
    reasons.push('Totale debiti incoerente con le passività totali ricostruite: verificare il bilancio.');
  }
  if (reasons.length) return { status: 'unavailable', reasons };

  const roa = netIncome / totalAssets;
  const leverage = totalLiabilities / totalAssets;
  const currentRatio = currentAssets / currentLiabilities;
  const score = -4.3 - 4.5 * roa + 5.7 * leverage - 0.004 * currentRatio;
  if (![totalLiabilities, roa, leverage, currentRatio, score].every(finite)) {
    return { status: 'unavailable', reasons: ['Rapporti non finiti: verificare importi e denominatori del bilancio.'] };
  }
  const warnings: string[] = [];
  const liquidityNote = input.kpi?.liquidita?.current_ratio?.source_note;
  if (liquidityNote?.includes('PROXY')) warnings.push(liquidityNote);
  if (quality !== 'alta') warnings.push('Verificare i valori estratti con il bilancio originale prima di utilizzare la stima.');
  if (!codiceAteco?.trim()) warnings.push('ATECO non disponibile: verificare che l’impresa non operi nel settore finanziario/assicurativo.');
  if (equity < 0) warnings.push('Patrimonio netto negativo: il rapporto passività/attivo supera il 100%.');
  return {
    status: 'estimated', probability: standardNormalCdf(score), score,
    ratios: { roa, leverage, currentRatio },
    amounts: { totalAssets, equity, netIncome, totalLiabilities, currentAssets, currentLiabilities },
    warnings,
  };
}

/** Never round an extreme estimate to an apparently certain 0% or 100%. */
export function formatDefaultProbability(probability: number): string {
  if (!finite(probability) || probability < 0 || probability > 1) return 'N/D';
  const percentage = probability * 100;
  if (percentage < 0.01) return '< 0,01%';
  if (percentage > 99.99) return '> 99,99%';
  return `${percentage.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
