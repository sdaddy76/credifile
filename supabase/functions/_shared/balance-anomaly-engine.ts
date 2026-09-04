export type BalanceAnomalyCategory =
  | 'coerenza_contabile'
  | 'andamento'
  | 'settore_ateco'
  | 'qualita_dato'
  | 'posta_da_chiarire';

export type BalanceAnomalySeverity = 'alta' | 'media' | 'bassa';
export type BalanceAnomalyConfidence = 'alta' | 'media' | 'bassa';

export interface BalanceAnomalyFinding {
  id: string;
  category: BalanceAnomalyCategory;
  severity: BalanceAnomalySeverity;
  confidence: BalanceAnomalyConfidence;
  title: string;
  explanation: string;
  evidence: string[];
  possible_explanations: string[];
  recommended_checks: string[];
}

export interface BalanceAnomalyAnalysis {
  engine_version: string;
  score: number;
  level: 'basso' | 'attenzione' | 'elevato' | 'critico';
  findings: BalanceAnomalyFinding[];
  analyzed_at: string;
  ateco_code?: string;
  sector_key?: string;
  sector_label?: string;
  comparison_year?: number | null;
  disclaimer: string;
}

export interface BalanceSnapshot {
  anno_esercizio?: number | null;
  totale_attivo?: number | null;
  totale_immobilizzazioni?: number | null;
  imm_immateriali?: number | null;
  imm_materiali?: number | null;
  imm_finanziarie?: number | null;
  totale_attivo_circolante?: number | null;
  rimanenze?: number | null;
  crediti_circolante?: number | null;
  disponibilita_liquide?: number | null;
  ratei_risconti_attivi?: number | null;
  totale_patrimonio_netto?: number | null;
  capitale_sociale?: number | null;
  fondi_rischi?: number | null;
  tfr?: number | null;
  debiti_banche_breve?: number | null;
  debiti_banche_lungo?: number | null;
  debiti_altri_finanziatori?: number | null;
  debiti_fornitori?: number | null;
  debiti_tributari?: number | null;
  totale_debiti?: number | null;
  ratei_risconti_passivi?: number | null;
  ricavi_vendite?: number | null;
  totale_valore_produzione?: number | null;
  costi_materie?: number | null;
  costi_servizi?: number | null;
  costo_personale?: number | null;
  ammortamenti?: number | null;
  oneri_diversi_gestione?: number | null;
  totale_costi_produzione?: number | null;
  differenza_ab?: number | null;
  proventi_partecipazioni?: number | null;
  interessi_passivi?: number | null;
  risultato_ante_imposte?: number | null;
  imposte?: number | null;
  utile_netto?: number | null;
  utile_perdita_esercizio?: number | null;
  is_holding?: boolean;
}

export interface AnalyzeBalanceAnomaliesInput {
  current: BalanceSnapshot;
  previous?: BalanceSnapshot | null;
  rawText?: string | null;
  atecoCode?: string | null;
  sectorKey?: string | null;
  sectorLabel?: string | null;
  benchmark?: Record<string, number | null> | null;
}

export const BALANCE_ANOMALY_ENGINE_VERSION = '1.0.0';

export const BALANCE_ANOMALY_DISCLAIMER =
  'L’analisi evidenzia indicatori di rischio, incoerenze e poste da approfondire. ' +
  'Non certifica la falsità del bilancio e non costituisce prova di frode. ' +
  'Ogni segnalazione deve essere verificata da un professionista mediante nota integrativa, ' +
  'mastrini, partitari, riconciliazioni e documenti giustificativi.';

const SEVERITY_WEIGHT: Record<BalanceAnomalySeverity, number> = {
  alta: 28,
  media: 14,
  bassa: 6,
};

const SEVERITY_ORDER: Record<BalanceAnomalySeverity, number> = {
  alta: 0,
  media: 1,
  bassa: 2,
};

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function amount(value: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function pct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function relativeChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (!finite(current) || !finite(previous) || Math.abs(previous) < 1) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function tolerance(reference: number, relative = 0.015): number {
  return Math.max(1_000, Math.abs(reference) * relative);
}

function outsideTolerance(actual: number, expected: number, relative = 0.015): boolean {
  return Math.abs(actual - expected) > tolerance(Math.max(Math.abs(actual), Math.abs(expected)), relative);
}

function makeFinding(
  id: string,
  category: BalanceAnomalyCategory,
  severity: BalanceAnomalySeverity,
  confidence: BalanceAnomalyConfidence,
  title: string,
  explanation: string,
  evidence: string[],
  possibleExplanations: string[],
  recommendedChecks: string[],
): BalanceAnomalyFinding {
  return {
    id,
    category,
    severity,
    confidence,
    title,
    explanation,
    evidence,
    possible_explanations: possibleExplanations,
    recommended_checks: recommendedChecks,
  };
}

function parseItalianNumber(raw: string): number | null {
  const compact = raw.trim().replace(/\s/g, '');
  if (!compact || compact === '-' || compact === '—') return null;
  const negative = compact.startsWith('(') && compact.endsWith(')');
  const unsigned = negative ? compact.slice(1, -1) : compact;
  const normalized = unsigned.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

function scanUnclearItems(rawText: string, materialityBase: number): Array<{ label: string; value: number }> {
  const terms = [
    'altri crediti',
    'altri debiti',
    'crediti diversi',
    'debiti diversi',
    'oneri diversi',
    'sopravvenienze',
    'rettifiche',
    'varie',
    'non specificato',
    'da definire',
  ];
  const normalized = rawText.replace(/\u00a0/g, ' ');
  const results = new Map<string, number>();

  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}[^\\d(]{0,80}(\\(?\\d[\\d. ]*(?:,\\d+)?\\)?)`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalized)) !== null) {
      const value = parseItalianNumber(match[1]);
      if (!finite(value)) continue;
      const absolute = Math.abs(value);
      if (absolute < Math.max(5_000, materialityBase * 0.02)) continue;
      results.set(term, Math.max(results.get(term) ?? 0, absolute));
    }
  }

  return [...results.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

function getKpiValue(
  current: BalanceSnapshot,
  key: 'DSO' | 'EBITDA Margin' | 'ROS' | 'ROE',
): number | null {
  const revenue = current.ricavi_vendite ?? current.totale_valore_produzione;
  const ebit = current.differenza_ab;
  const ebitda = finite(ebit) ? ebit + (current.ammortamenti ?? 0) : null;

  if (key === 'DSO') {
    return finite(current.crediti_circolante) && finite(current.ricavi_vendite) && current.ricavi_vendite > 0
      ? current.crediti_circolante / (current.ricavi_vendite / 365)
      : null;
  }
  if (key === 'EBITDA Margin') {
    return finite(ebitda) && finite(revenue) && revenue > 0 ? (ebitda / revenue) * 100 : null;
  }
  if (key === 'ROS') {
    return finite(ebit) && finite(revenue) && revenue > 0 ? (ebit / revenue) * 100 : null;
  }
  const equity = current.totale_patrimonio_netto;
  const netIncome = current.utile_netto ?? current.utile_perdita_esercizio;
  return finite(netIncome) && finite(equity) && equity > 0 ? (netIncome / equity) * 100 : null;
}

export function inferAtecoSectorKey(atecoCode?: string | null): string {
  const code = (atecoCode ?? '').replace(/\D/g, '');
  if (/^0[1-3]/.test(code)) return 'agricoltura';
  if (/^0[5-9]/.test(code)) return 'estrazione';
  if (/^[12][0-9]|^3[0-3]/.test(code)) return 'manifattura';
  if (/^35/.test(code)) return 'energia';
  if (/^3[6-9]/.test(code)) return 'acqua_rifiuti';
  if (/^4[1-3]/.test(code)) return 'costruzioni';
  if (/^4[5-7]/.test(code)) return 'commercio';
  if (/^4[9]|^5[0-3]/.test(code)) return 'trasporti';
  if (/^5[5-6]/.test(code)) return 'ristorazione';
  if (/^5[8-9]|^6[0-3]/.test(code)) return 'ict';
  if (/^6[4-6]/.test(code)) return 'finanza';
  if (/^68/.test(code)) return 'immobiliare';
  if (/^6[9]|^7[0-5]/.test(code)) return 'professionali';
  if (/^7[7-9]|^8[0-2]/.test(code)) return 'amministrativi';
  if (/^86|^87|^88/.test(code)) return 'sanita';
  return 'default';
}

export function analyzeBalanceAnomalies(input: AnalyzeBalanceAnomaliesInput): BalanceAnomalyAnalysis {
  const current = input.current;
  const previous = input.previous ?? null;
  const sectorKey = input.sectorKey || inferAtecoSectorKey(input.atecoCode);
  const findings: BalanceAnomalyFinding[] = [];

  const coreFields = [
    current.totale_attivo,
    current.totale_patrimonio_netto,
    current.totale_debiti,
    current.ricavi_vendite ?? current.totale_valore_produzione,
    current.totale_costi_produzione,
    current.utile_netto ?? current.utile_perdita_esercizio,
  ];
  const missingCore = coreFields.filter(value => !finite(value)).length;
  if (missingCore >= 3) {
    findings.push(makeFinding(
      'qualita-dati-principali',
      'qualita_dato',
      missingCore >= 5 ? 'alta' : 'media',
      'alta',
      'Dati principali incompleti',
      'Una parte rilevante delle voci necessarie ai controlli non è stata estratta. Le altre anomalie potrebbero dipendere dalla qualità del PDF o dal formato del bilancio.',
      [`Voci principali non disponibili: ${missingCore} su ${coreFields.length}`],
      ['PDF scansionato', 'Layout non standard', 'Bilancio abbreviato con dettaglio limitato'],
      ['Caricare XBRL quando disponibile', 'Verificare il testo estratto', 'Acquisire nota integrativa e prospetto analitico'],
    ));
  }

  if (!finite(current.anno_esercizio)) {
    findings.push(makeFinding(
      'anno-esercizio-mancante',
      'qualita_dato',
      'bassa',
      'alta',
      'Anno di esercizio non riconosciuto',
      'L’assenza dell’anno impedisce di ordinare con certezza i bilanci e confrontare correttamente gli esercizi.',
      ['Anno esercizio: non disponibile'],
      ['Intestazione non standard', 'Testo PDF incompleto'],
      ['Verificare manualmente la data di chiusura del bilancio'],
    ));
  }

  if (
    finite(current.totale_attivo) &&
    finite(current.totale_patrimonio_netto) &&
    finite(current.totale_debiti)
  ) {
    const expectedLiabilities =
      current.totale_patrimonio_netto +
      (current.fondi_rischi ?? 0) +
      (current.tfr ?? 0) +
      current.totale_debiti +
      (current.ratei_risconti_passivi ?? 0);
    if (outsideTolerance(current.totale_attivo, expectedLiabilities, 0.02)) {
      const gap = current.totale_attivo - expectedLiabilities;
      findings.push(makeFinding(
        'quadratura-stato-patrimoniale',
        'coerenza_contabile',
        Math.abs(gap) > Math.abs(current.totale_attivo) * 0.08 ? 'alta' : 'media',
        'alta',
        'Stato patrimoniale non quadrato',
        'Il totale attivo non coincide, oltre la tolleranza, con la somma delle principali componenti del passivo estratte.',
        [
          `Totale attivo: ${amount(current.totale_attivo)}`,
          `Passivo ricostruito: ${amount(expectedLiabilities)}`,
          `Scostamento: ${amount(gap)}`,
        ],
        ['Voce del passivo non estratta', 'Riclassificazione non standard', 'Errore nel documento o nel parsing'],
        ['Riconciliare attivo e passivo', 'Controllare fondi, TFR e ratei/risconti', 'Verificare il prospetto XBRL originale'],
      ));
    }
  }

  if (
    finite(current.totale_immobilizzazioni) &&
    [current.imm_immateriali, current.imm_materiali, current.imm_finanziarie].some(finite)
  ) {
    const detail =
      (current.imm_immateriali ?? 0) +
      (current.imm_materiali ?? 0) +
      (current.imm_finanziarie ?? 0);
    if (outsideTolerance(current.totale_immobilizzazioni, detail, 0.025)) {
      findings.push(makeFinding(
        'quadratura-immobilizzazioni',
        'coerenza_contabile',
        'media',
        'alta',
        'Dettaglio immobilizzazioni non coerente',
        'La somma delle immobilizzazioni immateriali, materiali e finanziarie non riconcilia con il totale.',
        [
          `Totale immobilizzazioni: ${amount(current.totale_immobilizzazioni)}`,
          `Dettaglio ricostruito: ${amount(detail)}`,
        ],
        ['Dettaglio incompleto', 'Voce letta da una colonna diversa', 'Riclassificazione del bilancio'],
        ['Verificare il prospetto delle immobilizzazioni', 'Controllare movimenti e fondi ammortamento'],
      ));
    }
  }

  if (
    finite(current.totale_valore_produzione) &&
    finite(current.totale_costi_produzione) &&
    finite(current.differenza_ab)
  ) {
    const expected = current.totale_valore_produzione - current.totale_costi_produzione;
    if (outsideTolerance(current.differenza_ab, expected, 0.02)) {
      findings.push(makeFinding(
        'quadratura-differenza-ab',
        'coerenza_contabile',
        'alta',
        'alta',
        'Risultato operativo non coerente',
        'La differenza tra valore e costi della produzione non coincide con il valore A-B riportato.',
        [
          `A-B riportato: ${amount(current.differenza_ab)}`,
          `A-B ricostruito: ${amount(expected)}`,
        ],
        ['Segni contabili interpretati in modo errato', 'Colonna di esercizio non corretta', 'Errore di estrazione'],
        ['Riconciliare il conto economico', 'Verificare la colonna dell’esercizio analizzato'],
      ));
    }
  }

  const netIncome = current.utile_netto ?? current.utile_perdita_esercizio;
  if (finite(current.risultato_ante_imposte) && finite(current.imposte) && finite(netIncome)) {
    const expected = current.risultato_ante_imposte - current.imposte;
    if (outsideTolerance(netIncome, expected, 0.03)) {
      findings.push(makeFinding(
        'quadratura-utile-netto',
        'coerenza_contabile',
        'alta',
        'alta',
        'Utile netto non riconciliato',
        'Il risultato ante imposte, al netto delle imposte, non riconcilia con l’utile o perdita dell’esercizio.',
        [
          `Utile netto riportato: ${amount(netIncome)}`,
          `Risultato ricostruito: ${amount(expected)}`,
        ],
        ['Imposte anticipate/differite non interpretate correttamente', 'Segno della voce imposte', 'Errore di estrazione'],
        ['Verificare il dettaglio delle imposte', 'Riconciliare risultato ante imposte e utile netto'],
      ));
    }
  }

  if (finite(current.totale_debiti)) {
    const debtDetail =
      (current.debiti_banche_breve ?? 0) +
      (current.debiti_banche_lungo ?? 0) +
      (current.debiti_altri_finanziatori ?? 0) +
      (current.debiti_fornitori ?? 0) +
      (current.debiti_tributari ?? 0);
    if (debtDetail > current.totale_debiti + tolerance(current.totale_debiti, 0.03)) {
      findings.push(makeFinding(
        'debiti-dettaglio-superiore',
        'coerenza_contabile',
        'media',
        'media',
        'Dettaglio debiti superiore al totale',
        'La somma delle categorie di debito estratte supera il totale debiti.',
        [
          `Totale debiti: ${amount(current.totale_debiti)}`,
          `Categorie estratte: ${amount(debtDetail)}`,
        ],
        ['Valori duplicati nella nota integrativa', 'Importi riferiti a esercizi diversi', 'Classificazioni sovrapposte'],
        ['Confrontare il dettaglio debiti con lo stato patrimoniale', 'Separare debiti entro e oltre 12 mesi'],
      ));
    }
  }

  if (previous) {
    const revenueCurrent = current.ricavi_vendite ?? current.totale_valore_produzione;
    const revenuePrevious = previous.ricavi_vendite ?? previous.totale_valore_produzione;
    const revenueChange = relativeChange(revenueCurrent, revenuePrevious);
    if (revenueChange !== null && Math.abs(revenueChange) >= 50) {
      findings.push(makeFinding(
        'andamento-ricavi',
        'andamento',
        Math.abs(revenueChange) >= 100 ? 'alta' : 'media',
        'media',
        'Variazione eccezionale dei ricavi',
        'I ricavi presentano una discontinuità rilevante rispetto all’esercizio precedente.',
        [
          `Ricavi ${previous.anno_esercizio ?? 'precedente'}: ${amount(revenuePrevious!)}`,
          `Ricavi ${current.anno_esercizio ?? 'corrente'}: ${amount(revenueCurrent!)}`,
          `Variazione: ${pct(revenueChange)}`,
        ],
        ['Crescita o contrazione reale', 'Operazione straordinaria', 'Cambio del perimetro', 'Competenza temporale non omogenea'],
        ['Verificare fatture di fine esercizio', 'Confrontare portafoglio ordini e IVA', 'Analizzare la relazione sulla gestione'],
      ));
    }

    const receivablesChange = relativeChange(current.crediti_circolante, previous.crediti_circolante);
    if (
      receivablesChange !== null &&
      receivablesChange >= 40 &&
      (revenueChange === null || receivablesChange - revenueChange >= 30)
    ) {
      findings.push(makeFinding(
        'crediti-piu-rapidi-ricavi',
        'andamento',
        receivablesChange >= 100 ? 'alta' : 'media',
        'media',
        'Crediti cresciuti molto più dei ricavi',
        'L’aumento dei crediti non è accompagnato da una crescita proporzionata dei ricavi. Può indicare rallentamento degli incassi o ricavi da verificare.',
        [
          `Variazione crediti: ${pct(receivablesChange)}`,
          `Variazione ricavi: ${revenueChange === null ? 'non disponibile' : pct(revenueChange)}`,
        ],
        ['Allungamento dei termini di pagamento', 'Nuovi grandi clienti', 'Fatturazione concentrata a fine anno', 'Crediti non commerciali inclusi nel totale'],
        ['Acquisire aging clienti', 'Verificare incassi successivi alla chiusura', 'Separare crediti commerciali, tributari e verso soci'],
      ));
    }

    const inventoryChange = relativeChange(current.rimanenze, previous.rimanenze);
    if (
      inventoryChange !== null &&
      inventoryChange >= 50 &&
      (revenueChange === null || inventoryChange - revenueChange >= 35)
    ) {
      findings.push(makeFinding(
        'rimanenze-piu-rapide-ricavi',
        'andamento',
        inventoryChange >= 120 ? 'alta' : 'media',
        'media',
        'Rimanenze cresciute molto più dei ricavi',
        'Il magazzino cresce in modo non proporzionato al volume d’affari, con possibile rischio di sovravalutazione o obsolescenza.',
        [
          `Variazione rimanenze: ${pct(inventoryChange)}`,
          `Variazione ricavi: ${revenueChange === null ? 'non disponibile' : pct(revenueChange)}`,
        ],
        ['Acquisti anticipati', 'Incremento dei prezzi', 'Commessa in corso', 'Accumulo di prodotti invenduti'],
        ['Acquisire inventario analitico', 'Verificare criteri di valorizzazione', 'Controllare obsolescenza e rotazione'],
      ));
    }

    const intangibleChange = relativeChange(current.imm_immateriali, previous.imm_immateriali);
    if (intangibleChange !== null && intangibleChange >= 100 && (current.imm_immateriali ?? 0) > 25_000) {
      findings.push(makeFinding(
        'incremento-immateriali',
        'andamento',
        'media',
        'media',
        'Forte incremento delle immobilizzazioni immateriali',
        'L’aumento delle attività immateriali può dipendere dalla capitalizzazione di costi che richiede verifica dei requisiti contabili.',
        [`Variazione immobilizzazioni immateriali: ${pct(intangibleChange)}`],
        ['Software o brevetti acquisiti', 'Costi di sviluppo capitalizzati', 'Avviamento da acquisizione'],
        ['Esaminare libro cespiti', 'Verificare fatture e delibere', 'Controllare vita utile e test di recuperabilità'],
      ));
    }

    const cashChange = relativeChange(current.disponibilita_liquide, previous.disponibilita_liquide);
    if (cashChange !== null && Math.abs(cashChange) >= 200 && Math.abs(current.disponibilita_liquide ?? 0) > 25_000) {
      findings.push(makeFinding(
        'variazione-liquidita',
        'andamento',
        'bassa',
        'media',
        'Liquidità variata in modo eccezionale',
        'La cassa e i depositi bancari mostrano una variazione molto ampia nell’ultimo esercizio.',
        [`Variazione disponibilità liquide: ${pct(cashChange)}`],
        ['Nuovo finanziamento', 'Aumento di capitale', 'Investimento o disinvestimento', 'Incasso/pagamento vicino alla chiusura'],
        ['Riconciliare estratti conto al 31 dicembre', 'Verificare movimenti rilevanti a cavallo d’anno'],
      ));
    }
  }

  const revenue = current.ricavi_vendite ?? current.totale_valore_produzione ?? 0;
  const asset = current.totale_attivo ?? 0;
  const inventoryRatio = asset > 0 ? ((current.rimanenze ?? 0) / asset) * 100 : 0;
  const materialCostRatio = revenue > 0 ? ((current.costi_materie ?? 0) / revenue) * 100 : null;
  const personnelRatio = revenue > 0 ? ((current.costo_personale ?? 0) / revenue) * 100 : null;
  const tangibleRatio = asset > 0 ? ((current.imm_materiali ?? 0) / asset) * 100 : null;
  const financialAssetsRatio = asset > 0 ? ((current.imm_finanziarie ?? 0) / asset) * 100 : null;

  if (['professionali', 'ict', 'finanza', 'amministrativi'].includes(sectorKey) && inventoryRatio >= 12) {
    findings.push(makeFinding(
      'rimanenze-atipiche-settore',
      'settore_ateco',
      inventoryRatio >= 25 ? 'media' : 'bassa',
      'media',
      'Rimanenze elevate per il settore dichiarato',
      'Il peso del magazzino appare poco tipico per un’attività prevalentemente di servizi o finanziaria.',
      [`Rimanenze / Totale attivo: ${inventoryRatio.toFixed(1)}%`, `Macrosettore: ${input.sectorLabel ?? sectorKey}`],
      ['Lavori in corso su commessa', 'Attività secondaria commerciale', 'Codice ATECO non rappresentativo'],
      ['Richiedere dettaglio rimanenze', 'Verificare attività effettivamente svolta e codici ATECO secondari'],
    ));
  }

  if (
    ['manifattura', 'commercio', 'costruzioni'].includes(sectorKey) &&
    revenue >= 100_000 &&
    (materialCostRatio === null || materialCostRatio < 1)
  ) {
    findings.push(makeFinding(
      'materie-prime-atipiche-settore',
      'settore_ateco',
      'media',
      'media',
      'Costo materie assente o molto basso',
      'Per il macrosettore indicato, il costo di materie o merci risulta insolitamente basso rispetto ai ricavi.',
      [
        `Costo materie / Ricavi: ${materialCostRatio === null ? 'non disponibile' : `${materialCostRatio.toFixed(1)}%`}`,
        `Macrosettore: ${input.sectorLabel ?? sectorKey}`,
      ],
      ['Produzione affidata interamente a terzi', 'Ricavi da servizi', 'Voce non estratta correttamente'],
      ['Verificare conto economico analitico', 'Separare merci, materie e lavorazioni esterne'],
    ));
  }

  if (
    ['professionali', 'sanita', 'amministrativi'].includes(sectorKey) &&
    revenue >= 150_000 &&
    (personnelRatio === null || personnelRatio < 2)
  ) {
    findings.push(makeFinding(
      'personale-atipico-settore',
      'settore_ateco',
      'media',
      'media',
      'Costo del personale assente o molto basso',
      'Un’attività ad alta intensità di lavoro presenta costi del personale non proporzionati ai ricavi.',
      [
        `Costo personale / Ricavi: ${personnelRatio === null ? 'non disponibile' : `${personnelRatio.toFixed(1)}%`}`,
        `Macrosettore: ${input.sectorLabel ?? sectorKey}`,
      ],
      ['Uso prevalente di collaboratori o società esterne', 'Compensi classificati nei servizi', 'Voce non estratta'],
      ['Verificare libro unico del lavoro', 'Analizzare costi per servizi e compensi amministratori'],
    ));
  }

  if (
    ['trasporti', 'manifattura'].includes(sectorKey) &&
    revenue >= 300_000 &&
    tangibleRatio !== null &&
    tangibleRatio < 2
  ) {
    findings.push(makeFinding(
      'immobilizzazioni-materiali-atipiche',
      'settore_ateco',
      'bassa',
      'bassa',
      'Immobilizzazioni materiali molto contenute',
      'Il settore è normalmente caratterizzato da mezzi o impianti, ma le immobilizzazioni materiali risultano molto ridotte.',
      [`Immobilizzazioni materiali / Totale attivo: ${tangibleRatio.toFixed(1)}%`],
      ['Beni in leasing o noleggio', 'Produzione completamente esternalizzata', 'Società commerciale del gruppo'],
      ['Acquisire dettaglio leasing e noleggi', 'Verificare cespiti utilizzati ma non di proprietà'],
    ));
  }

  if (
    !current.is_holding &&
    finite(current.proventi_partecipazioni) &&
    current.proventi_partecipazioni > Math.max(50_000, revenue * 0.5)
  ) {
    findings.push(makeFinding(
      'proventi-partecipazioni-prevalenti',
      'settore_ateco',
      'media',
      'media',
      'Proventi da partecipazioni predominanti',
      'I proventi da partecipazioni hanno un peso rilevante rispetto all’attività operativa, pur non risultando una holding.',
      [
        `Proventi da partecipazioni: ${amount(current.proventi_partecipazioni)}`,
        `Ricavi operativi: ${amount(revenue)}`,
      ],
      ['Dividendo straordinario', 'Società operativa con partecipazioni strategiche', 'Classificazione ATECO non aggiornata'],
      ['Acquisire struttura del gruppo', 'Verificare origine e ricorrenza dei proventi'],
    ));
  }

  if (financialAssetsRatio !== null && financialAssetsRatio >= 35 && !current.is_holding && sectorKey !== 'finanza') {
    findings.push(makeFinding(
      'immobilizzazioni-finanziarie-rilevanti',
      'settore_ateco',
      financialAssetsRatio >= 60 ? 'media' : 'bassa',
      'media',
      'Immobilizzazioni finanziarie rilevanti',
      'Una quota importante dell’attivo è investita in partecipazioni o attività finanziarie, elemento non tipico di molte imprese operative.',
      [`Immobilizzazioni finanziarie / Totale attivo: ${financialAssetsRatio.toFixed(1)}%`],
      ['Partecipazioni strategiche', 'Crediti finanziari infragruppo', 'Riorganizzazione societaria'],
      ['Richiedere dettaglio partecipazioni e crediti finanziari', 'Valutare recuperabilità e rapporti con parti correlate'],
    ));
  }

  for (const metric of ['DSO', 'EBITDA Margin', 'ROS', 'ROE'] as const) {
    const value = getKpiValue(current, metric);
    const benchmark = input.benchmark?.[metric] ?? null;
    if (!finite(value) || !finite(benchmark) || benchmark === 0) continue;

    if (metric === 'DSO' && value > Math.max(benchmark * 1.8, benchmark + 60)) {
      findings.push(makeFinding(
        'dso-sopra-benchmark',
        'settore_ateco',
        value > benchmark * 2.5 ? 'media' : 'bassa',
        'bassa',
        'Tempi di incasso molto superiori al benchmark',
        'Il DSO stimato sui crediti circolanti è sensibilmente superiore al riferimento macrosettoriale.',
        [`DSO stimato: ${Math.round(value)} giorni`, `Benchmark: ${Math.round(benchmark)} giorni`],
        ['Crediti non commerciali inclusi', 'Clientela pubblica', 'Contenziosi o ritardi di incasso'],
        ['Acquisire aging crediti', 'Separare i crediti commerciali', 'Verificare incassi successivi'],
      ));
    }

    if (metric !== 'DSO' && value > benchmark * 2.5 && value > benchmark + 12) {
      findings.push(makeFinding(
        `margine-insolitamente-alto-${metric.toLowerCase().replace(/\s/g, '-')}`,
        'settore_ateco',
        'bassa',
        'bassa',
        `${metric} insolitamente superiore al settore`,
        'Una redditività molto superiore al benchmark non è negativa di per sé, ma merita verifica della sua sostenibilità e delle componenti non ricorrenti.',
        [`${metric}: ${value.toFixed(1)}%`, `Benchmark macrosettoriale: ${benchmark.toFixed(1)}%`],
        ['Vantaggio competitivo reale', 'Evento non ricorrente', 'Ricavi o costi classificati diversamente'],
        ['Separare componenti ricorrenti e straordinarie', 'Confrontare più esercizi', 'Verificare operazioni con parti correlate'],
      ));
    }
  }

  if (finite(netIncome) && netIncome > 0 && finite(current.differenza_ab) && current.differenza_ab < 0) {
    findings.push(makeFinding(
      'utile-positivo-gestione-negativa',
      'andamento',
      'media',
      'alta',
      'Utile positivo con gestione operativa negativa',
      'L’esercizio chiude in utile nonostante un risultato operativo negativo; l’utile dipende quindi da componenti finanziarie, fiscali o non ricorrenti.',
      [`Differenza A-B: ${amount(current.differenza_ab)}`, `Utile netto: ${amount(netIncome)}`],
      ['Proventi finanziari o da partecipazioni', 'Benefici fiscali', 'Componenti straordinarie'],
      ['Riconciliare le componenti extra-operative', 'Valutare la ricorrenza dell’utile'],
    ));
  }

  if (input.rawText && (asset > 0 || revenue > 0)) {
    const unclearItems = scanUnclearItems(input.rawText, Math.max(asset, revenue));
    for (const item of unclearItems) {
      findings.push(makeFinding(
        `posta-generica-${item.label.replace(/\s+/g, '-')}`,
        'posta_da_chiarire',
        item.value > Math.max(asset, revenue) * 0.1 ? 'media' : 'bassa',
        'media',
        `Posta generica rilevante: ${item.label}`,
        'La descrizione della voce è generica e l’importo è materialmente rilevante; senza il dettaglio non è possibile comprenderne natura e recuperabilità/esigibilità.',
        [`Importo individuato: ${amount(item.value)}`],
        ['Aggregazione prevista dal formato abbreviato', 'Voce composta da partite ordinarie', 'Partite infragruppo o non ricorrenti'],
        ['Richiedere dettaglio analitico della voce', 'Acquisire mastrino e partitari', 'Verificare controparti e movimenti successivi'],
      ));
    }
  }

  const uniqueFindings = [...new Map(findings.map(finding => [finding.id, finding])).values()]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title, 'it'));
  const score = Math.min(100, uniqueFindings.reduce((sum, finding) => {
    const confidenceFactor = finding.confidence === 'alta' ? 1 : finding.confidence === 'media' ? 0.75 : 0.45;
    return sum + SEVERITY_WEIGHT[finding.severity] * confidenceFactor;
  }, 0));
  const roundedScore = Math.round(score);
  const level: BalanceAnomalyAnalysis['level'] =
    roundedScore >= 60 ? 'critico' :
    roundedScore >= 35 ? 'elevato' :
    roundedScore >= 15 ? 'attenzione' :
    'basso';

  return {
    engine_version: BALANCE_ANOMALY_ENGINE_VERSION,
    score: roundedScore,
    level,
    findings: uniqueFindings,
    analyzed_at: new Date().toISOString(),
    ateco_code: input.atecoCode ?? undefined,
    sector_key: sectorKey,
    sector_label: input.sectorLabel ?? undefined,
    comparison_year: previous?.anno_esercizio ?? null,
    disclaimer: BALANCE_ANOMALY_DISCLAIMER,
  };
}
