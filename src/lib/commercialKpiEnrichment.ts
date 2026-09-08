import { analyzeBankStatement, type BankStatementTransaction } from '@/lib/bankStatementAnalysis';
import type { KpiEntry, KpiResult } from '@/lib/bankabilityScoring';

export interface CommercialBalanceData {
  totale_attivo?: number | null;
  totale_patrimonio_netto?: number | null;
  totale_valore_produzione?: number | null;
  totale_costi_produzione?: number | null;
  ricavi_vendite?: number | null;
  differenza_ab?: number | null;
  risultato_ante_imposte?: number | null;
  interessi_passivi?: number | null;
  proventi_partecipazioni?: number | null;
  ammortamenti?: number | null;
  disponibilita_liquide?: number | null;
  debiti_banche_breve?: number | null;
  debiti_banche_lungo?: number | null;
  debiti_altri_finanziatori?: number | null;
  voci_mancanti?: string[] | null;
  kpi?: KpiResult | null;
}

export interface CommercialFinancingData {
  debito_residuo?: number | string | null;
  rata?: number | string | null;
  fonte?: string | null;
}

export interface EnrichedCommercialKpis {
  kpi: KpiResult;
  dscrSource: 'finanziamenti' | 'estratto_conto' | 'non_disponibile';
  servizioDebitoAnnuo: number | null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function euro(value: number | null): string {
  if (value === null) return 'N/D';
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number | null): string {
  return value === null ? 'N/D' : `${value.toFixed(1)}%`;
}

function multiple(value: number | null): string {
  return value === null ? 'N/D' : `${value.toFixed(2)}x`;
}

function semaforoHigher(value: number | null, green: number, yellow: number): KpiEntry['semaforo'] {
  if (value === null) return 'nd';
  return value >= green ? 'verde' : value >= yellow ? 'giallo' : 'rosso';
}

function semaforoLower(value: number | null, green: number, yellow: number): KpiEntry['semaforo'] {
  if (value === null) return 'nd';
  return value <= green ? 'verde' : value <= yellow ? 'giallo' : 'rosso';
}

function financingSource(financing: CommercialFinancingData[]): string {
  const sources = new Set(financing.map(item => (item.fonte ?? '').toLowerCase()).filter(Boolean));
  if ([...sources].some(source => source.includes('centrale_rischi'))) {
    return sources.size > 1 ? 'Finanziamenti in essere e Centrale Rischi' : 'Centrale Rischi';
  }
  return 'Finanziamenti in essere';
}

function cloneWithDefaultSources(kpi: KpiResult | null | undefined): KpiResult {
  const cloned: KpiResult = {};
  for (const [area, entries] of Object.entries(kpi ?? {})) {
    cloned[area] = {};
    for (const [key, entry] of Object.entries(entries ?? {})) {
      cloned[area][key] = {
        ...entry,
        source: entry.source ?? (entry.valore === null ? 'Non disponibile' : 'Bilancio'),
        source_note: entry.source_note,
      };
    }
  }
  return cloned;
}

function setEntry(
  result: KpiResult,
  area: string,
  key: string,
  entry: KpiEntry,
) {
  result[area] = result[area] ?? {};
  result[area][key] = entry;
}

export function enrichCommercialKpis(
  balance: CommercialBalanceData | null | undefined,
  financing: CommercialFinancingData[] = [],
  transactions: BankStatementTransaction[] = [],
): EnrichedCommercialKpis {
  const result = cloneWithDefaultSources(balance?.kpi);
  if (!balance) {
    return { kpi: result, dscrSource: 'non_disponibile', servizioDebitoAnnuo: null };
  }

  const ebit = finite(balance.differenza_ab)
    ? balance.differenza_ab
    : finite(balance.totale_valore_produzione) && finite(balance.totale_costi_produzione)
      ? balance.totale_valore_produzione - balance.totale_costi_produzione
      : finite(balance.risultato_ante_imposte)
        ? balance.risultato_ante_imposte
          + (finite(balance.interessi_passivi) ? balance.interessi_passivi : 0)
          - (finite(balance.proventi_partecipazioni) ? balance.proventi_partecipazioni : 0)
        : null;
  const ebitSourceNote = finite(balance.differenza_ab)
    ? 'Risultato operativo A-B'
    : finite(balance.totale_valore_produzione) && finite(balance.totale_costi_produzione)
      ? 'Ricostruito da valore e costi della produzione'
      : ebit !== null
        ? 'Ricostruito dal risultato ante imposte'
        : 'Risultato operativo non disponibile';
  const ebitda = ebit !== null && finite(balance.ammortamenti)
    ? ebit + balance.ammortamenti
    : null;

  const roi = ebit !== null && finite(balance.totale_attivo) && balance.totale_attivo > 0
    ? (ebit / balance.totale_attivo) * 100
    : null;
  const rosBase = finite(balance.totale_valore_produzione) && balance.totale_valore_produzione > 0
    ? balance.totale_valore_produzione
    : finite(balance.ricavi_vendite) && balance.ricavi_vendite > 0
      ? balance.ricavi_vendite
      : null;
  const ros = ebit !== null && rosBase !== null ? (ebit / rosBase) * 100 : null;
  const ebitdaMargin = ebitda !== null && rosBase !== null ? (ebitda / rosBase) * 100 : null;
  const interestCoverage = ebit !== null
    && finite(balance.interessi_passivi)
    && balance.interessi_passivi > 0
    ? ebit / balance.interessi_passivi
    : null;

  setEntry(result, 'redditivita', 'roi', {
    label: 'ROI',
    valore: roi,
    formatted: percent(roi),
    semaforo: semaforoHigher(roi, 3, 0),
    source: roi === null ? 'Non disponibile' : 'Bilancio',
    source_note: roi === null ? 'Mancano risultato operativo o totale attivo' : ebitSourceNote,
  });
  setEntry(result, 'redditivita', 'ros', {
    label: 'ROS',
    valore: ros,
    formatted: percent(ros),
    semaforo: semaforoHigher(ros, 3, 0),
    source: ros === null ? 'Non disponibile' : 'Bilancio',
    source_note: ros === null ? 'Mancano risultato operativo o valore della produzione' : ebitSourceNote,
  });
  setEntry(result, 'redditivita', 'ebitda_margin', {
    label: 'EBITDA Margin',
    valore: ebitdaMargin,
    formatted: percent(ebitdaMargin),
    semaforo: semaforoHigher(ebitdaMargin, 10, 5),
    source: ebitdaMargin === null ? 'Non disponibile' : 'Bilancio',
    source_note: ebitdaMargin === null
      ? 'Mancano risultato operativo, ammortamenti o valore della produzione'
      : `${ebitSourceNote}; EBITDA inclusivo degli ammortamenti`,
  });
  setEntry(result, 'redditivita', 'ebitda_eur', {
    label: 'EBITDA (€)',
    valore: ebitda,
    formatted: euro(ebitda),
    semaforo: ebitda === null ? 'nd' : ebitda > 0 ? 'verde' : 'rosso',
    source: ebitda === null ? 'Non disponibile' : 'Bilancio',
    source_note: ebitda === null ? 'Mancano risultato operativo o ammortamenti' : ebitSourceNote,
  });
  setEntry(result, 'copertura', 'interest_coverage', {
    label: 'Interest Coverage',
    valore: interestCoverage,
    formatted: multiple(interestCoverage),
    semaforo: semaforoHigher(interestCoverage, 3, 1.5),
    source: interestCoverage === null ? 'Non disponibile' : 'Bilancio',
    source_note: interestCoverage === null ? 'Mancano EBIT o interessi passivi' : ebitSourceNote,
  });

  const activeFinancing = financing.filter(item => (numeric(item.debito_residuo) ?? 0) > 0);
  const residualDebt = activeFinancing.length > 0
    ? activeFinancing.reduce((sum, item) => sum + (numeric(item.debito_residuo) ?? 0), 0)
    : null;
  const missingBalanceDebt = new Set(balance.voci_mancanti ?? []);
  const balanceDebtParts = [
    ['debiti_banche_breve', balance.debiti_banche_breve],
    ['debiti_banche_lungo', balance.debiti_banche_lungo],
    ['debiti_altri_finanziatori', balance.debiti_altri_finanziatori],
  ] as const;
  const availableBalanceDebt = balanceDebtParts.filter(([key, value]) =>
    !missingBalanceDebt.has(key) && finite(value)
  );
  const balanceDebt = availableBalanceDebt.length > 0
    ? availableBalanceDebt.reduce((sum, [, value]) => sum + (value ?? 0), 0)
    : null;
  const financialDebt = residualDebt ?? balanceDebt;
  const debtSource = residualDebt !== null ? financingSource(activeFinancing) : 'Bilancio';
  const pfn = financialDebt !== null && finite(balance.disponibilita_liquide)
    ? financialDebt - balance.disponibilita_liquide
    : null;
  const pfnSource = pfn === null ? 'Non disponibile' : `${debtSource} + Bilancio`;
  const pfnNote = pfn === null
    ? 'Mancano debito finanziario attendibile o disponibilità liquide'
    : `Debito finanziario ${euro(financialDebt)} meno liquidità ${euro(balance.disponibilita_liquide ?? null)}`;
  const pfnEbitda = pfn !== null && ebitda !== null && ebitda > 0 ? pfn / ebitda : null;
  const pfnPn = pfn !== null
    && finite(balance.totale_patrimonio_netto)
    && balance.totale_patrimonio_netto > 0
    ? pfn / balance.totale_patrimonio_netto
    : null;

  setEntry(result, 'indebitamento', 'pfn', {
    label: 'PFN (€)',
    valore: pfn,
    formatted: euro(pfn),
    semaforo: pfn === null
      ? 'nd'
      : pfn <= 0
        ? 'verde'
        : finite(balance.totale_patrimonio_netto) && pfn <= balance.totale_patrimonio_netto
          ? 'giallo'
          : 'rosso',
    source: pfnSource,
    source_note: pfnNote,
  });
  setEntry(result, 'indebitamento', 'pfn_ebitda', {
    label: 'PFN / EBITDA',
    valore: pfnEbitda,
    formatted: multiple(pfnEbitda),
    semaforo: semaforoLower(pfnEbitda, 3, 5),
    source: pfnEbitda === null ? 'Non disponibile' : pfnSource,
    source_note: pfnEbitda === null ? `${pfnNote}; EBITDA non disponibile` : pfnNote,
  });
  setEntry(result, 'indebitamento', 'pfn_pn', {
    label: 'PFN / PN',
    valore: pfnPn,
    formatted: multiple(pfnPn),
    semaforo: semaforoLower(pfnPn, 1, 2),
    source: pfnPn === null ? 'Non disponibile' : pfnSource,
    source_note: pfnPn === null ? `${pfnNote}; patrimonio netto non disponibile` : pfnNote,
  });

  const financingRatesComplete = activeFinancing.length > 0
    && activeFinancing.every(item => (numeric(item.rata) ?? 0) > 0);
  let debtService = financingRatesComplete
    ? activeFinancing.reduce((sum, item) => sum + (numeric(item.rata) ?? 0), 0) * 12
    : null;
  let dscrSource: EnrichedCommercialKpis['dscrSource'] = financingRatesComplete
    ? 'finanziamenti'
    : 'non_disponibile';
  let dscrSourceLabel = financingRatesComplete ? financingSource(activeFinancing) : 'Non disponibile';
  let dscrSourceNote = financingRatesComplete
    ? `Servizio annuo del debito ${euro(debtService)}`
    : 'Rate non complete nella situazione finanziamenti';

  if (debtService === null && transactions.length > 0) {
    const statement = analyzeBankStatement(transactions);
    if (
      statement.monthsAnalyzed >= 2
      && statement.reliablePercentage >= 70
      && statement.recurringFinancingPayments.length > 0
    ) {
      debtService = statement.recurringFinancingPayments
        .reduce((sum, item) => sum + item.averageAmount, 0) * 12;
      dscrSource = 'estratto_conto';
      dscrSourceLabel = 'Estratto conto';
      dscrSourceNote = `Rate ricorrenti riconosciute su ${statement.monthsAnalyzed} mesi; servizio annuo stimato ${euro(debtService)}`;
    }
  }

  const dscr = debtService !== null && debtService > 0 && ebitda !== null
    ? ebitda / debtService
    : null;
  setEntry(result, 'copertura', 'dscr', {
    label: dscrSource === 'finanziamenti'
      ? 'DSCR (da finanziamenti)'
      : dscrSource === 'estratto_conto'
        ? 'DSCR (da estratto conto)'
        : 'DSCR',
    valore: dscr,
    formatted: multiple(dscr),
    semaforo: semaforoHigher(dscr, 1.25, 1),
    source: dscr === null ? 'Non disponibile' : dscrSourceLabel,
    source_note: dscr === null
      ? `${dscrSourceNote}; non viene usato EBITDA/interessi come sostituto del DSCR`
      : dscrSourceNote,
  });

  return {
    kpi: result,
    dscrSource,
    servizioDebitoAnnuo: debtService,
  };
}
