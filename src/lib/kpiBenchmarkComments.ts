import type { KpiScore } from '@/lib/generateReportPdf';

export type KpiBenchmarkTone = 'positive' | 'neutral' | 'warning' | 'critical' | 'unavailable';

export interface KpiBenchmarkComparison {
  key: string;
  label: string;
  area: string;
  areaLabel: string;
  value: number | null;
  valueFormatted: string;
  benchmark: number | null;
  benchmarkFormatted: string;
  delta: number | null;
  deltaFormatted: string;
  deltaPercent: number | null;
  deltaPercentFormatted: string;
  score: number | null;
  inverse: boolean;
  judgement: string;
  tone: KpiBenchmarkTone;
  comment: string;
}

const AREA_LABELS: Record<string, string> = {
  liquidita: 'Liquidità',
  solidita: 'Solidità patrimoniale',
  redditivita: 'Redditività',
  indebitamento: 'Indebitamento',
  efficienza: 'Efficienza operativa',
  copertura: 'Copertura del debito',
};

const PERCENT_KPIS = new Set(['ebitda_margin', 'roe', 'roi', 'ros', 'pn_totale_attivo']);
const DAYS_KPIS = new Set(['dso']);

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString('it-IT', {
    minimumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
    maximumFractionDigits,
  });
}

export function formatKpiBenchmarkValue(kpiKey: string, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/D';
  if (PERCENT_KPIS.has(kpiKey)) return `${formatNumber(value, 2)}%`;
  if (DAYS_KPIS.has(kpiKey)) return `${formatNumber(value, 1)} gg`;
  return `${formatNumber(value, 2)}x`;
}

function formatDelta(kpiKey: string, delta: number | null): string {
  if (delta === null) return 'N/D';
  const sign = delta > 0 ? '+' : '';
  if (PERCENT_KPIS.has(kpiKey)) return `${sign}${formatNumber(delta, 2)} p.p.`;
  if (DAYS_KPIS.has(kpiKey)) return `${sign}${formatNumber(delta, 1)} gg`;
  return `${sign}${formatNumber(delta, 2)}x`;
}

function formatDeltaPercent(deltaPercent: number | null): string {
  if (deltaPercent === null || !Number.isFinite(deltaPercent)) return 'N/D';
  const sign = deltaPercent > 0 ? '+' : '';
  return `${sign}${deltaPercent.toLocaleString('it-IT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function getPosition(favourableDeltaPercent: number | null): {
  judgement: string;
  tone: KpiBenchmarkTone;
  phrase: string;
} {
  if (favourableDeltaPercent === null) {
    return { judgement: 'N/D', tone: 'unavailable', phrase: 'non confrontabile' };
  }
  if (favourableDeltaPercent >= 20) {
    return { judgement: 'Punto di forza', tone: 'positive', phrase: 'nettamente migliore del benchmark' };
  }
  if (favourableDeltaPercent >= 5) {
    return { judgement: 'Sopra benchmark', tone: 'positive', phrase: 'migliore del benchmark' };
  }
  if (favourableDeltaPercent > -5) {
    return { judgement: 'In linea', tone: 'neutral', phrase: 'sostanzialmente in linea con il benchmark' };
  }
  if (favourableDeltaPercent > -20) {
    return { judgement: 'Sotto benchmark', tone: 'warning', phrase: 'meno favorevole del benchmark' };
  }
  return { judgement: 'Da approfondire', tone: 'critical', phrase: 'nettamente meno favorevole del benchmark' };
}

function indicatorInterpretation(key: string, tone: KpiBenchmarkTone): string {
  const favourable = tone === 'positive';
  const neutral = tone === 'neutral';
  switch (key) {
    case 'dscr':
      return favourable
        ? 'La generazione operativa offre un margine di copertura del servizio del debito superiore alle imprese comparabili.'
        : neutral
          ? 'La copertura del servizio del debito è coerente con il settore; va mantenuta sotto controllo in caso di nuovo indebitamento.'
          : 'Il margine di copertura del servizio del debito è inferiore al settore: verificare rate annue, flussi di cassa prospettici e sostenibilità di nuovi finanziamenti.';
    case 'pfn_ebitda':
      return favourable
        ? 'Il debito finanziario netto richiede meno anni di EBITDA per essere rimborsato rispetto al settore.'
        : neutral
          ? 'La leva finanziaria rispetto all’EBITDA è allineata al settore.'
          : 'Il debito finanziario netto pesa più della media sulla capacità operativa di rimborso; approfondire struttura, scadenze e dinamica della PFN.';
    case 'ebitda_margin':
      return favourable
        ? 'La gestione caratteristica genera un margine operativo lordo superiore al settore.'
        : neutral
          ? 'La capacità di generare margine operativo è in linea con le imprese comparabili.'
          : 'La marginalità operativa è più debole del settore; approfondire prezzi, mix di vendita e incidenza dei costi operativi.';
    case 'current_ratio':
      return favourable
        ? 'La copertura delle passività correnti mediante attività correnti è più solida rispetto al settore.'
        : neutral
          ? 'L’equilibrio finanziario di breve periodo è coerente con il settore.'
          : 'La copertura dei debiti a breve è inferiore al settore; verificare capitale circolante, scadenze e fabbisogno di liquidità.';
    case 'quick_ratio':
      return favourable
        ? 'La liquidità di breve, al netto delle rimanenze, è più robusta rispetto al settore.'
        : neutral
          ? 'La liquidità senza il contributo del magazzino è allineata al settore.'
          : 'La liquidità immediatamente mobilizzabile è inferiore al settore; verificare dipendenza dal magazzino e qualità dei crediti.';
    case 'roe':
      return favourable
        ? 'La remunerazione del patrimonio netto supera il settore; il dato va letto insieme a leva e capitalizzazione.'
        : neutral
          ? 'La redditività del capitale proprio è in linea con il settore.'
          : 'La remunerazione del patrimonio netto è inferiore al settore; approfondire utile netto, mezzi propri e componenti non ricorrenti.';
    case 'roi':
      return favourable
        ? 'Il capitale investito produce un rendimento operativo superiore alle imprese comparabili.'
        : neutral
          ? 'Il rendimento operativo del capitale investito è coerente con il settore.'
          : 'Il rendimento degli investimenti è inferiore al settore; verificare produttività degli asset e redditività operativa.';
    case 'ros':
      return favourable
        ? 'Il margine operativo sulle vendite è superiore al settore.'
        : neutral
          ? 'La redditività operativa delle vendite è allineata al settore.'
          : 'Il margine sulle vendite è inferiore al settore; approfondire politiche di prezzo, costi diretti e costi di struttura.';
    case 'leverage':
      return favourable
        ? 'La struttura patrimoniale presenta una leva più contenuta rispetto al settore.'
        : neutral
          ? 'Il rapporto tra attivo e patrimonio netto è in linea con il settore.'
          : 'La leva è superiore al settore e segnala una maggiore dipendenza da capitale di terzi; verificare capitalizzazione e composizione dell’attivo.';
    case 'pfn_pn':
      return favourable
        ? 'La posizione finanziaria netta è contenuta rispetto ai mezzi propri e al benchmark.'
        : neutral
          ? 'Il rapporto tra debito finanziario netto e patrimonio è allineato al settore.'
          : 'Il debito finanziario netto è elevato rispetto ai mezzi propri; approfondire capacità di patrimonializzazione e piano di rientro.';
    case 'debt_equity':
      return favourable
        ? 'Il peso dei debiti rispetto al patrimonio netto è inferiore al settore.'
        : neutral
          ? 'Il rapporto tra debiti e patrimonio netto è coerente con il settore.'
          : 'Il ricorso al debito è superiore al benchmark; verificare composizione, scadenze e adeguatezza dei mezzi propri.';
    case 'pn_totale_attivo':
      return favourable
        ? 'La quota di attivo finanziata con mezzi propri è superiore al settore.'
        : neutral
          ? 'Il livello di capitalizzazione è allineato al settore.'
          : 'La capitalizzazione è inferiore al settore; valutare rafforzamento patrimoniale e qualità delle poste dell’attivo.';
    case 'dso':
      return favourable
        ? 'I tempi medi di incasso sono più brevi del settore, con minore assorbimento di capitale circolante.'
        : neutral
          ? 'I tempi di incasso risultano coerenti con le prassi del settore.'
          : 'I tempi di incasso sono più lunghi del benchmark; approfondire concentrazione clienti, scaduto e qualità dei crediti.';
    case 'interest_coverage':
      return favourable
        ? 'Il risultato operativo copre gli oneri finanziari con un margine superiore al settore.'
        : neutral
          ? 'La copertura degli interessi passivi è allineata al settore.'
          : 'La copertura degli oneri finanziari è inferiore al settore; verificare costo del debito, marginalità e sensibilità ai tassi.';
    default:
      return favourable
        ? 'L’indicatore presenta un posizionamento migliore rispetto al settore.'
        : neutral
          ? 'L’indicatore è allineato al settore.'
          : 'L’indicatore richiede un approfondimento rispetto alle imprese comparabili.';
  }
}

export function buildKpiBenchmarkComparison(
  kpi: KpiScore,
  sectorBenchmarks: Record<string, number | null> | null | undefined,
): KpiBenchmarkComparison {
  const benchmarkKey = kpi.benchmark_key ?? kpi.kpi_label;
  const benchmark = sectorBenchmarks?.[benchmarkKey] ?? null;
  const value = kpi.valore;
  const delta = value !== null && benchmark !== null ? value - benchmark : null;
  const deltaPercent = delta !== null && benchmark !== 0
    ? (delta / Math.abs(benchmark)) * 100
    : null;
  const valueFormatted = value === null
    ? 'N/D'
    : formatKpiBenchmarkValue(kpi.kpi_key, value);
  const favourableDeltaPercent = deltaPercent === null
    ? null
    : kpi.inverso
      ? -deltaPercent
      : deltaPercent;
  const position = getPosition(favourableDeltaPercent);

  let comment: string;
  if (value === null) {
    comment = `Il valore aziendale di ${kpi.kpi_label} non è disponibile: completare o verificare i dati di bilancio necessari al calcolo.`;
  } else if (benchmark === null) {
    comment = `Il valore aziendale di ${kpi.kpi_label} è ${valueFormatted}, ma il benchmark settoriale non è disponibile; il confronto viene quindi indicato come N/D.`;
  } else {
    const directionNote = kpi.inverso ? 'per questo indicatore un valore più basso è preferibile' : 'per questo indicatore un valore più alto è preferibile';
    comment = `Il valore aziendale (${valueFormatted}) è ${position.phrase} (${formatKpiBenchmarkValue(kpi.kpi_key, benchmark)}; scostamento ${formatDelta(kpi.kpi_key, delta)}, ${formatDeltaPercent(deltaPercent)}; ${directionNote}). ${indicatorInterpretation(kpi.kpi_key, position.tone)}`;
  }

  return {
    key: kpi.kpi_key,
    label: kpi.kpi_label,
    area: kpi.kpi_area,
    areaLabel: AREA_LABELS[kpi.kpi_area] ?? kpi.kpi_area,
    value,
    valueFormatted,
    benchmark,
    benchmarkFormatted: formatKpiBenchmarkValue(kpi.kpi_key, benchmark),
    delta,
    deltaFormatted: formatDelta(kpi.kpi_key, delta),
    deltaPercent,
    deltaPercentFormatted: formatDeltaPercent(deltaPercent),
    score: kpi.score,
    inverse: kpi.inverso,
    judgement: position.judgement,
    tone: position.tone,
    comment,
  };
}

export function buildKpiBenchmarkComparisons(
  scores: KpiScore[],
  sectorBenchmarks: Record<string, number | null> | null | undefined,
): KpiBenchmarkComparison[] {
  return scores.map(score => buildKpiBenchmarkComparison(score, sectorBenchmarks));
}
