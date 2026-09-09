export const COMMERCIAL_REPORT_SECTION_KEYS = {
  companySituation: '__company_situation',
  growthOpportunities: '__growth_opportunities',
  mainBalanceItems: '__main_balance_items',
  yearOverYear: '__year_over_year_comment',
  provisionalBalance: '__provisional_balance_comment',
} as const;

export const COMMERCIAL_REPORT_SECTIONS = [
  {
    key: COMMERCIAL_REPORT_SECTION_KEYS.companySituation,
    title: 'Situazione economico-finanziaria della società',
    description: 'Valutazione complessiva basata sui dati disponibili, senza sostituire con zero le informazioni mancanti.',
  },
  {
    key: COMMERCIAL_REPORT_SECTION_KEYS.growthOpportunities,
    title: 'Opportunità e leve di crescita',
    description: 'Opportunità coerenti con l’andamento documentato di ricavi, margini, liquidità e struttura finanziaria.',
  },
  {
    key: COMMERCIAL_REPORT_SECTION_KEYS.mainBalanceItems,
    title: 'Principali voci di bilancio',
    description: 'Commento delle poste più rilevanti di Stato patrimoniale e Conto economico.',
  },
  {
    key: COMMERCIAL_REPORT_SECTION_KEYS.yearOverYear,
    title: 'Confronto con l’esercizio precedente',
    description: 'Variazioni tra gli ultimi due bilanci annuali disponibili.',
  },
  {
    key: COMMERCIAL_REPORT_SECTION_KEYS.provisionalBalance,
    title: 'Commento al bilancio provvisorio',
    description: 'Lettura del provvisorio caricato, con avvertenza quando il periodo non è direttamente confrontabile con un esercizio annuale.',
  },
] as const;

export type CommercialReportSectionKey = typeof COMMERCIAL_REPORT_SECTIONS[number]['key'];

export interface CommercialBalanceRecord {
  id?: string | null;
  uploaded_file_id?: string | null;
  anno_esercizio?: number | null;
  periodo_inizio?: string | null;
  periodo_fine?: string | null;
  mesi_coperti?: number | string | null;
  giorni_coperti?: number | string | null;
  is_provvisorio?: boolean | null;
  created_at?: string | null;
  totale_attivo?: number | string | null;
  totale_immobilizzazioni?: number | string | null;
  totale_attivo_circolante?: number | string | null;
  passivita_correnti?: number | string | null;
  rimanenze?: number | string | null;
  crediti_circolante?: number | string | null;
  disponibilita_liquide?: number | string | null;
  totale_patrimonio_netto?: number | string | null;
  capitale_sociale?: number | string | null;
  utile_perdita_esercizio?: number | string | null;
  debiti_banche_breve?: number | string | null;
  debiti_banche_lungo?: number | string | null;
  debiti_altri_finanziatori?: number | string | null;
  debiti_fornitori?: number | string | null;
  debiti_tributari?: number | string | null;
  totale_debiti?: number | string | null;
  ricavi_vendite?: number | string | null;
  totale_valore_produzione?: number | string | null;
  costi_materie?: number | string | null;
  costi_servizi?: number | string | null;
  costo_personale?: number | string | null;
  ammortamenti?: number | string | null;
  totale_costi_produzione?: number | string | null;
  differenza_ab?: number | string | null;
  interessi_passivi?: number | string | null;
  risultato_ante_imposte?: number | string | null;
  imposte?: number | string | null;
  utile_netto?: number | string | null;
  voci_mancanti?: unknown;
}

export interface CommercialReportAnalysis {
  sections: Record<CommercialReportSectionKey, string>;
  latestAnnual: CommercialBalanceRecord | null;
  previousAnnual: CommercialBalanceRecord | null;
  provisional: CommercialBalanceRecord | null;
  provisionalMonths: number | null;
  provisionalAnnualized: CommercialBalanceRecord | null;
  financialEvolution: string;
}

type BuildOptions = {
  balances: CommercialBalanceRecord[];
  provisionalFileIds?: Iterable<string>;
  hasProvisionalDocument?: boolean;
};

const euro = (value: number | null) => value === null
  ? 'N/D'
  : new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value);

const numberValue = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstNumber = (...values: Array<number | string | null | undefined>): number | null => {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const FLOW_FIELDS: Array<keyof CommercialBalanceRecord> = [
  'ricavi_vendite',
  'totale_valore_produzione',
  'costi_materie',
  'costi_servizi',
  'costo_personale',
  'ammortamenti',
  'totale_costi_produzione',
  'differenza_ab',
  'interessi_passivi',
  'risultato_ante_imposte',
  'imposte',
  'utile_netto',
  'utile_perdita_esercizio',
];

const dateOnly = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Restituisce i mesi effettivamente coperti da un bilancio provvisorio.
 * Non deduce il periodo dal solo anno: in assenza di date il dato resta N/D.
 */
export function getBalancePeriodMonths(balance: CommercialBalanceRecord | null): number | null {
  if (!balance) return null;
  const explicit = numberValue(balance.mesi_coperti);
  if (explicit !== null && explicit > 0 && explicit <= 12) return explicit;
  const start = dateOnly(balance.periodo_inizio);
  const end = dateOnly(balance.periodo_fine);
  if (!start || !end || end < start) return null;
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const endMonthLastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  if (startDay === 1 && endDay === endMonthLastDay) {
    return (end.getUTCFullYear() - start.getUTCFullYear()) * 12
      + end.getUTCMonth() - start.getUTCMonth() + 1;
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const months = days / (365.2425 / 12);
  return months > 0 && months <= 12.5 ? Math.round(months * 100) / 100 : null;
}

/**
 * Annualizza esclusivamente le grandezze di flusso. Le poste patrimoniali
 * (attivo, PN, debiti, liquidità, crediti e rimanenze) restano al valore
 * puntuale della data di riferimento.
 */
export function annualizeBalanceFlows(
  balance: CommercialBalanceRecord | null,
  monthsCovered: number | null = getBalancePeriodMonths(balance),
): CommercialBalanceRecord | null {
  if (!balance || monthsCovered === null || monthsCovered <= 0 || monthsCovered >= 12) return balance;
  const factor = 12 / monthsCovered;
  const annualized = { ...balance };
  for (const field of FLOW_FIELDS) {
    const value = numberValue(balance[field] as number | string | null | undefined);
    if (value !== null) (annualized as Record<string, unknown>)[field] = value * factor;
  }
  return annualized;
}

const periodLabel = (balance: CommercialBalanceRecord | null, months: number | null) => {
  if (!balance) return 'periodo non disponibile';
  const start = dateOnly(balance.periodo_inizio);
  const end = dateOnly(balance.periodo_fine);
  if (start && end) {
    const format = (date: Date) => date.toLocaleDateString('it-IT', { timeZone: 'UTC' });
    return `${format(start)}–${format(end)} (${months?.toLocaleString('it-IT', { maximumFractionDigits: 2 }) ?? 'N/D'} mesi)`;
  }
  return months !== null
    ? `${months.toLocaleString('it-IT', { maximumFractionDigits: 2 })} mesi documentati`
    : 'periodo non documentato';
};

const yearLabel = (balance: CommercialBalanceRecord | null) =>
  balance?.anno_esercizio ? String(balance.anno_esercizio) : 'anno non disponibile';

const ebit = (balance: CommercialBalanceRecord | null): number | null => {
  if (!balance) return null;
  const direct = numberValue(balance.differenza_ab);
  if (direct !== null) return direct;
  const value = numberValue(balance.totale_valore_produzione);
  const costs = numberValue(balance.totale_costi_produzione);
  return value !== null && costs !== null ? value - costs : null;
};

const ebitda = (balance: CommercialBalanceRecord | null): number | null => {
  const operatingResult = ebit(balance);
  const depreciation = numberValue(balance?.ammortamenti);
  if (operatingResult === null || depreciation === null) return null;
  return operatingResult + depreciation;
};

const netIncome = (balance: CommercialBalanceRecord | null): number | null =>
  balance ? firstNumber(balance.utile_netto, balance.utile_perdita_esercizio) : null;

const margin = (balance: CommercialBalanceRecord | null): number | null => {
  const revenue = firstNumber(balance?.totale_valore_produzione, balance?.ricavi_vendite);
  const operatingCashFlow = ebitda(balance);
  if (revenue === null || revenue === 0 || operatingCashFlow === null) return null;
  return (operatingCashFlow / revenue) * 100;
};

const percent = (value: number | null) => value === null
  ? 'N/D'
  : `${value.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const deltaPercent = (current: number | null, previous: number | null): number | null => {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

const comparison = (
  label: string,
  current: number | null,
  previous: number | null,
  currentYear: string,
  previousYear: string,
) => {
  if (current === null && previous === null) return null;
  const delta = deltaPercent(current, previous);
  const deltaText = delta === null
    ? 'variazione percentuale non calcolabile'
    : `variazione ${delta >= 0 ? '+' : ''}${percent(delta)}`;
  return `${label}: ${euro(current)} nel ${currentYear} rispetto a ${euro(previous)} nel ${previousYear} (${deltaText}).`;
};

const listAvailable = (items: Array<string | null>, fallback: string) => {
  const available = items.filter((item): item is string => Boolean(item));
  return available.length > 0 ? available.join('\n') : fallback;
};

function buildCompanySituation(latest: CommercialBalanceRecord | null): string {
  if (!latest) {
    return 'Non disponibile: non risultano bilanci annuali analizzati per la pratica.';
  }

  const revenue = numberValue(latest.ricavi_vendite);
  const production = numberValue(latest.totale_valore_produzione);
  const operatingCashFlow = ebitda(latest);
  const operatingMargin = margin(latest);
  const profit = netIncome(latest);
  const equity = numberValue(latest.totale_patrimonio_netto);
  const totalAssets = numberValue(latest.totale_attivo);
  const totalDebt = numberValue(latest.totale_debiti);
  const liquidity = numberValue(latest.disponibilita_liquide);

  const resultTone = profit === null
    ? 'Il risultato netto non è disponibile nei dati analizzati.'
    : profit >= 0
      ? `L’esercizio chiude con un risultato positivo pari a ${euro(profit)}.`
      : `L’esercizio chiude con una perdita pari a ${euro(Math.abs(profit))}, elemento da approfondire.`;
  const capitalization = equity !== null && totalAssets !== null && totalAssets !== 0
    ? `Il patrimonio netto è pari a ${euro(equity)} e rappresenta ${percent((equity / totalAssets) * 100)} dell’attivo.`
    : `Patrimonio netto ${euro(equity)}; incidenza sull’attivo non verificabile.`;

  return [
    `L’analisi si riferisce al bilancio ${yearLabel(latest)}. Ricavi delle vendite: ${euro(revenue)}; valore della produzione: ${euro(production)}.`,
    `L’EBITDA ricostruibile dai dati disponibili è ${euro(operatingCashFlow)}, con margine sui ricavi pari a ${percent(operatingMargin)}.`,
    resultTone,
    capitalization,
    `Debiti complessivi: ${euro(totalDebt)}; disponibilità liquide: ${euro(liquidity)}. I valori non estratti dal bilancio restano indicati come N/D e richiedono verifica documentale.`,
  ].join(' ');
}

function buildGrowthOpportunities(
  latest: CommercialBalanceRecord | null,
  previous: CommercialBalanceRecord | null,
): string {
  if (!latest) {
    return 'Non disponibile: le opportunità di crescita non possono essere valutate senza un bilancio analizzato.';
  }

  const revenueGrowth = deltaPercent(
    numberValue(latest.ricavi_vendite),
    numberValue(previous?.ricavi_vendite),
  );
  const marginCurrent = margin(latest);
  const marginPrevious = margin(previous);
  const liquidityCurrent = numberValue(latest.disponibilita_liquide);
  const liquidityPrevious = numberValue(previous?.disponibilita_liquide);
  const bankDebtCurrent = [
    numberValue(latest.debiti_banche_breve),
    numberValue(latest.debiti_banche_lungo),
    numberValue(latest.debiti_altri_finanziatori),
  ].reduce<number | null>((sum, value) => value === null ? sum : (sum ?? 0) + value, null);
  const bankDebtPrevious = previous
    ? [
        numberValue(previous.debiti_banche_breve),
        numberValue(previous.debiti_banche_lungo),
        numberValue(previous.debiti_altri_finanziatori),
      ].reduce<number | null>((sum, value) => value === null ? sum : (sum ?? 0) + value, null)
    : null;

  const observations: string[] = [];
  if (revenueGrowth !== null) {
    observations.push(revenueGrowth > 0
      ? `• La crescita dei ricavi (${revenueGrowth >= 0 ? '+' : ''}${percent(revenueGrowth)}) offre una base documentata per consolidare i mercati e i prodotti che stanno sostenendo l’espansione.`
      : `• La contrazione dei ricavi (${percent(revenueGrowth)}) rende prioritaria la verifica di portafoglio clienti, volumi, prezzi e mix di vendita prima di formulare obiettivi di crescita.`);
  }
  if (marginCurrent !== null && marginPrevious !== null) {
    const change = marginCurrent - marginPrevious;
    observations.push(change >= 0
      ? `• Il margine EBITDA migliora di ${percent(change)} punti rispetto all’esercizio precedente: la leva di crescita è preservare la disciplina sui costi e privilegiare le attività a maggiore marginalità.`
      : `• Il margine EBITDA si riduce di ${percent(Math.abs(change))} punti: l’opportunità principale consiste nel recupero della marginalità attraverso pricing, mix e controllo dei costi operativi.`);
  }
  if (liquidityCurrent !== null && liquidityPrevious !== null) {
    observations.push(liquidityCurrent >= liquidityPrevious
      ? `• Le disponibilità liquide aumentano da ${euro(liquidityPrevious)} a ${euro(liquidityCurrent)}; il maggior cuscinetto può sostenere investimenti coerenti con i flussi di cassa.`
      : `• Le disponibilità liquide diminuiscono da ${euro(liquidityPrevious)} a ${euro(liquidityCurrent)}; prima di finanziare la crescita è opportuno intervenire su incassi, scorte e scadenze del capitale circolante.`);
  }
  if (bankDebtCurrent !== null && bankDebtPrevious !== null) {
    observations.push(bankDebtCurrent <= bankDebtPrevious
      ? `• L’esposizione finanziaria rilevabile si riduce da ${euro(bankDebtPrevious)} a ${euro(bankDebtCurrent)}, creando potenzialmente maggiore spazio per nuovi investimenti sostenibili.`
      : `• L’esposizione finanziaria rilevabile aumenta da ${euro(bankDebtPrevious)} a ${euro(bankDebtCurrent)}; ogni ulteriore crescita deve essere accompagnata da verifica di DSCR, durata e servizio annuo del debito.`);
  }

  return listAvailable(
    observations,
    'Non verificabile: i dati storici disponibili non consentono di individuare leve di crescita documentate. Integrare almeno due esercizi comparabili e informazioni commerciali.',
  );
}

function buildMainBalanceItems(latest: CommercialBalanceRecord | null): string {
  if (!latest) return 'Non disponibile: non risultano voci di bilancio analizzate.';
  const year = yearLabel(latest);
  const items = [
    `• Ricavi delle vendite ${year}: ${euro(numberValue(latest.ricavi_vendite))}; valore della produzione: ${euro(numberValue(latest.totale_valore_produzione))}.`,
    `• Costi per materie: ${euro(numberValue(latest.costi_materie))}; servizi: ${euro(numberValue(latest.costi_servizi))}; personale: ${euro(numberValue(latest.costo_personale))}; ammortamenti: ${euro(numberValue(latest.ammortamenti))}.`,
    `• Totale attivo: ${euro(numberValue(latest.totale_attivo))}; immobilizzazioni: ${euro(numberValue(latest.totale_immobilizzazioni))}; attivo circolante: ${euro(numberValue(latest.totale_attivo_circolante))}.`,
    `• Rimanenze: ${euro(numberValue(latest.rimanenze))}; crediti dell’attivo circolante: ${euro(numberValue(latest.crediti_circolante))}; disponibilità liquide: ${euro(numberValue(latest.disponibilita_liquide))}.`,
    `• Patrimonio netto: ${euro(numberValue(latest.totale_patrimonio_netto))}; debiti complessivi: ${euro(numberValue(latest.totale_debiti))}; debiti verso fornitori: ${euro(numberValue(latest.debiti_fornitori))}; debiti tributari: ${euro(numberValue(latest.debiti_tributari))}.`,
    `• Debiti bancari a breve: ${euro(numberValue(latest.debiti_banche_breve))}; a medio-lungo termine: ${euro(numberValue(latest.debiti_banche_lungo))}; altri finanziatori: ${euro(numberValue(latest.debiti_altri_finanziatori))}.`,
  ];
  return `${items.join('\n')}\nLe poste indicate come N/D non sono state ricostruite in modo attendibile e non vengono considerate pari a zero.`;
}

function buildYearOverYear(
  latest: CommercialBalanceRecord | null,
  previous: CommercialBalanceRecord | null,
): string {
  if (!latest || !previous) {
    return 'Non disponibile: servono almeno due bilanci annuali analizzati e comparabili.';
  }
  const currentYear = yearLabel(latest);
  const previousYear = yearLabel(previous);
  return listAvailable([
    comparison('Ricavi delle vendite', numberValue(latest.ricavi_vendite), numberValue(previous.ricavi_vendite), currentYear, previousYear),
    comparison('Valore della produzione', numberValue(latest.totale_valore_produzione), numberValue(previous.totale_valore_produzione), currentYear, previousYear),
    comparison('EBITDA ricostruibile', ebitda(latest), ebitda(previous), currentYear, previousYear),
    comparison('Risultato netto', netIncome(latest), netIncome(previous), currentYear, previousYear),
    comparison('Patrimonio netto', numberValue(latest.totale_patrimonio_netto), numberValue(previous.totale_patrimonio_netto), currentYear, previousYear),
    comparison('Debiti complessivi', numberValue(latest.totale_debiti), numberValue(previous.totale_debiti), currentYear, previousYear),
    comparison('Disponibilità liquide', numberValue(latest.disponibilita_liquide), numberValue(previous.disponibilita_liquide), currentYear, previousYear),
  ], 'Non verificabile: gli esercizi disponibili non contengono voci omogenee sufficienti al confronto.');
}

function buildProvisionalComment(
  provisional: CommercialBalanceRecord | null,
  latestAnnual: CommercialBalanceRecord | null,
  hasProvisionalDocument: boolean,
): string {
  if (!provisional) {
    return hasProvisionalDocument
      ? 'Il bilancio provvisorio risulta caricato, ma non è disponibile una sua analisi strutturata. Analizzare il documento prima di inviare la relazione alla banca; fino ad allora i dati restano Non disponibili.'
      : 'Non disponibile: non è stato identificato un bilancio provvisorio tra i documenti analizzati della pratica.';
  }

  const months = getBalancePeriodMonths(provisional);
  const annualized = annualizeBalanceFlows(provisional, months);
  const period = periodLabel(provisional, months);
  const baseYear = yearLabel(latestAnnual);
  const lines = [
    `Il bilancio provvisorio identificato per il periodo ${period} riporta ricavi per ${euro(numberValue(provisional.ricavi_vendite))}, valore della produzione per ${euro(numberValue(provisional.totale_valore_produzione))}, EBITDA ricostruibile per ${euro(ebitda(provisional))} e risultato netto per ${euro(netIncome(provisional))}.`,
    `Patrimonio netto: ${euro(numberValue(provisional.totale_patrimonio_netto))}; debiti complessivi: ${euro(numberValue(provisional.totale_debiti))}; disponibilità liquide: ${euro(numberValue(provisional.disponibilita_liquide))}.`,
  ];
  if (months !== null && months < 12 && annualized) {
    lines.push(
      `Per rendere leggibile l’evoluzione, i flussi sono annualizzati con fattore ${((12 / months)).toLocaleString('it-IT', { maximumFractionDigits: 2 })}: ricavi prospettici ${euro(numberValue(annualized.ricavi_vendite))}, valore della produzione prospettico ${euro(numberValue(annualized.totale_valore_produzione))}, EBITDA prospettico ${euro(ebitda(annualized))} e risultato netto prospettico ${euro(netIncome(annualized))}. Le poste patrimoniali restano quelle rilevate alla data del provvisorio.`);
  } else if (months === null) {
    lines.push('Il periodo infrannuale non è documentato in modo sufficiente: non viene applicata alcuna annualizzazione.');
  }
  if (latestAnnual) {
    lines.push(
      `Confronto con il bilancio annuale ${baseYear}: ricavi effettivi ${euro(numberValue(provisional.ricavi_vendite))}${annualized && months !== null && months < 12 ? ` (proiezione annua ${euro(numberValue(annualized.ricavi_vendite))})` : ''} rispetto a ${euro(numberValue(latestAnnual.ricavi_vendite))}; EBITDA effettivo ${euro(ebitda(provisional))}${annualized && months !== null && months < 12 ? ` (proiezione annua ${euro(ebitda(annualized))})` : ''} rispetto a ${euro(ebitda(latestAnnual))}.`,
    );
  }
  lines.push('La proiezione è indicativa e non sostituisce il bilancio annuale approvato; deve essere validata sul documento originale.');
  return lines.join(' ');
}

function buildFinancialEvolution(
  latestAnnual: CommercialBalanceRecord | null,
  previousAnnual: CommercialBalanceRecord | null,
  provisional: CommercialBalanceRecord | null,
): string {
  const annualLines = [
    previousAnnual ? `Bilancio ${yearLabel(previousAnnual)}: ricavi ${euro(numberValue(previousAnnual.ricavi_vendite))}, EBITDA ${euro(ebitda(previousAnnual))}, utile ${euro(netIncome(previousAnnual))}, PN ${euro(numberValue(previousAnnual.totale_patrimonio_netto))}.` : null,
    latestAnnual ? `Bilancio ${yearLabel(latestAnnual)}: ricavi ${euro(numberValue(latestAnnual.ricavi_vendite))}, EBITDA ${euro(ebitda(latestAnnual))}, utile ${euro(netIncome(latestAnnual))}, PN ${euro(numberValue(latestAnnual.totale_patrimonio_netto))}.` : null,
  ].filter((line): line is string => Boolean(line));
  if (!provisional) return listAvailable(annualLines, 'Non disponibile: non risultano bilanci comparabili.');

  const months = getBalancePeriodMonths(provisional);
  const annualized = annualizeBalanceFlows(provisional, months);
  const provisionalLine = `Provvisorio ${yearLabel(provisional)} (${periodLabel(provisional, months)}): ricavi effettivi ${euro(numberValue(provisional.ricavi_vendite))}, EBITDA effettivo ${euro(ebitda(provisional))}, utile effettivo ${euro(netIncome(provisional))}, PN puntuale ${euro(numberValue(provisional.totale_patrimonio_netto))}.`;
  annualLines.push(provisionalLine);
  if (annualized && months !== null && months < 12) {
    annualLines.push(`Provvisorio ${yearLabel(provisional)} annualizzato sui flussi: ricavi ${euro(numberValue(annualized.ricavi_vendite))}, EBITDA ${euro(ebitda(annualized))}, utile ${euro(netIncome(annualized))}; attivo, PN, debiti, liquidità e altre poste patrimoniali non sono annualizzati.`);
  } else if (months === null) {
    annualLines.push('Il provvisorio è incluso nell’evoluzione con i valori effettivi, ma senza proiezione perché il periodo coperto non è documentato.');
  }
  return annualLines.join('\n');
}

export function buildCommercialReportAnalysis({
  balances,
  provisionalFileIds = [],
  hasProvisionalDocument = false,
}: BuildOptions): CommercialReportAnalysis {
  const provisionalIds = new Set(provisionalFileIds);
  const sorted = [...balances].sort((a, b) => {
    const yearDelta = (b.anno_esercizio ?? 0) - (a.anno_esercizio ?? 0);
    if (yearDelta !== 0) return yearDelta;
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
  const provisionalBalances = sorted.filter(balance =>
    Boolean(balance.uploaded_file_id && provisionalIds.has(balance.uploaded_file_id)),
  );
  const annualBalances = sorted.filter(balance =>
    !balance.uploaded_file_id || !provisionalIds.has(balance.uploaded_file_id),
  );
  const latestAnnual = annualBalances[0] ?? null;
  const previousAnnual = annualBalances[1] ?? null;
  const provisional = provisionalBalances[0] ?? null;
  const provisionalMonths = getBalancePeriodMonths(provisional);
  const provisionalAnnualized = annualizeBalanceFlows(provisional, provisionalMonths);
  const financialEvolution = buildFinancialEvolution(latestAnnual, previousAnnual, provisional);

  return {
    latestAnnual,
    previousAnnual,
    provisional,
    provisionalMonths,
    provisionalAnnualized,
    financialEvolution,
    sections: {
      [COMMERCIAL_REPORT_SECTION_KEYS.companySituation]: buildCompanySituation(latestAnnual),
      [COMMERCIAL_REPORT_SECTION_KEYS.growthOpportunities]: buildGrowthOpportunities(latestAnnual, previousAnnual),
      [COMMERCIAL_REPORT_SECTION_KEYS.mainBalanceItems]: buildMainBalanceItems(latestAnnual),
      [COMMERCIAL_REPORT_SECTION_KEYS.yearOverYear]: [
        buildYearOverYear(latestAnnual, previousAnnual),
        provisional ? `\nEvoluzione estesa con il provvisorio:\n${financialEvolution}` : '',
      ].join(''),
      [COMMERCIAL_REPORT_SECTION_KEYS.provisionalBalance]: buildProvisionalComment(
        provisional,
        latestAnnual,
        hasProvisionalDocument || provisionalBalances.length > 0,
      ),
    },
  };
}
