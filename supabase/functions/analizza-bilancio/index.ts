import {
  analyzeBalanceAnomalies,
  inferAtecoSectorKey,
  type BalanceSnapshot,
} from '../_shared/balance-anomaly-engine.ts';
import {
  BALANCE_VALUE_PATTERNS,
  extractBalanceValue,
  splitBalanceDocument,
} from '../_shared/balance-parser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, ...data as object }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function fail(msg: string, status = 200) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const serviceHeaders = {
  'apikey': SERVICE_ROLE,
  'Authorization': `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
};

async function fetchJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: serviceHeaders });
  if (!response.ok) return null;
  return await response.json() as T;
}

async function getSectorContext(codiceAteco?: string | null) {
  const sectorKey = inferAtecoSectorKey(codiceAteco);
  const rows = await fetchJson<Array<{
    ateco_macro: string;
    ateco_label: string;
    kpi_data: Record<string, number | null>;
  }>>(
    `sector_benchmarks?ateco_macro=eq.${encodeURIComponent(sectorKey)}&select=ateco_macro,ateco_label,kpi_data&limit=1`,
  );
  return {
    sectorKey,
    sectorLabel: rows?.[0]?.ateco_label ?? sectorKey,
    benchmark: rows?.[0]?.kpi_data ?? null,
  };
}

async function getPracticeAteco(practiceId: string): Promise<string | null> {
  const practiceRows = await fetchJson<Array<{ codice_ateco: string | null; client_id: string | null }>>(
    `practices?id=eq.${encodeURIComponent(practiceId)}&select=codice_ateco,client_id&limit=1`,
  );
  const practiceAteco = practiceRows?.[0]?.codice_ateco?.trim() || null;
  if (practiceAteco) return practiceAteco;

  const clientId = practiceRows?.[0]?.client_id;
  if (!clientId) return null;
  const clientRows = await fetchJson<Array<{ codice_ateco: string | null }>>(
    `clients?id=eq.${encodeURIComponent(clientId)}&select=codice_ateco&limit=1`,
  );
  return clientRows?.[0]?.codice_ateco?.trim() || null;
}

// ─── Parsing numeri in formato italiano ──────────────────────────────────────
// ─── Parser XBRL deterministico ──────────────────────────────────────────────
function parseBilancio(text: string) {
  const sections = splitBalanceDocument(text);
  const e = (source: string, patterns: string[]) => extractBalanceValue(source, patterns);
  const eAttivo = (patterns: string[]) => e(sections.attivo, patterns);
  const ePassivo = (patterns: string[]) => e(sections.passivo, patterns);
  const eCe = (patterns: string[]) => e(sections.contoEconomico, patterns);

  // Dati anagrafici — supporta sia markdown (##) che testo grezzo pdfjs
  const rsMatch = text.match(/(?:^|\n)\s*(?:##\s*)?([^\n]{2,160}?)\s+Bilancio di esercizio al/i);
  const ragione_sociale = rsMatch ? rsMatch[1].trim() : null;
  const annoMatch = text.match(/Bilancio di esercizio al\s+\d{1,2}[-/]\d{2}[-/](\d{4})/);
  const anno_esercizio = annoMatch ? parseInt(annoMatch[1]) : null;
  const atecoMatch = text.match(/(?:ATECO|attività prevalente)[^0-9]{0,30}(\d{4,6}(?:[.,]\d{1,2})?)/i);
  const codice_ateco = atecoMatch?.[1]?.replace(',', '.') ?? null;

  // SP Attivo
  const totale_attivo = eAttivo(['Totale attivo']);
  const totale_immobilizzazioni = eAttivo(['Totale immobilizzazioni (B)', 'Totale immobilizzazioni']);
  const imm_immateriali = eAttivo(['I - Immobilizzazioni immateriali', 'Immobilizzazioni immateriali']);
  const imm_materiali = eAttivo(['II - Immobilizzazioni materiali', 'Immobilizzazioni materiali']);
  const imm_finanziarie = eAttivo(['III - Immobilizzazioni finanziarie', 'Immobilizzazioni finanziarie']);
  const totale_attivo_circolante = eAttivo(['Totale attivo circolante (C)', 'Totale attivo circolante']);
  const rimanenze = eAttivo(['I - Rimanenze', 'Totale rimanenze', 'Rimanenze']);
  const crediti_circolante = eAttivo(['Totale crediti']);
  const disponibilita_liquide = eAttivo(['IV - Disponibilità liquide', 'Disponibilità liquide']);
  const ratei_risconti_attivi = eAttivo(['D) Ratei e risconti', 'Ratei e risconti attivi']);

  // SP Passivo
  const totale_patrimonio_netto = ePassivo(['Totale patrimonio netto']);
  const capitale_sociale = ePassivo(['I - Capitale', 'Capitale']);
  const utile_perdita_esercizio = ePassivo(['IX - Utile (perdita)', 'Utile (perdita) dell\'esercizio']);
  const fondi_rischi = ePassivo(['B) Fondi per rischi', 'Fondi per rischi e oneri']);
  const tfr = ePassivo(['C) Trattamento di fine rapporto', 'Trattamento di fine rapporto di lavoro']);
  const totale_debiti = ePassivo(['Totale debiti']);
  const ratei_risconti_passivi = ePassivo(['E) Ratei e risconti', 'Ratei e risconti passivi']);
  const totale_passivo = ePassivo(['Totale passivo']);

  // Dettaglio debiti (dalla nota integrativa)
  const debiti_banche_breve = e(sections.full, ['Debiti verso banche']);
  const debiti_altri_finanziatori = e(sections.full, ['Debiti verso altri finanziatori']);
  const debiti_fornitori = e(sections.full, ['Debiti verso fornitori']);
  const debiti_tributari = e(sections.full, ['Debiti tributari']);

  // CE
  const ricavi_vendite = eCe(['1) ricavi delle vendite', 'ricavi delle vendite e delle prestazioni']);
  const totale_valore_produzione = eCe(['Totale valore della produzione']);
  const costi_materie = eCe([...BALANCE_VALUE_PATTERNS.costiMaterie]);
  const costi_servizi = eCe(['per servizi', 'Servizi']);
  const costo_personale_salari = eCe(['Salari e stipendi']);
  const costo_personale_oneri = eCe(['Oneri sociali']);
  const costo_personale_tfr_quota = eCe(['Trattamento di fine rapporto']);
  const costo_personale = (costo_personale_salari ?? 0) + (costo_personale_oneri ?? 0) + (costo_personale_tfr_quota ?? 0) || null;
  const ammortamentiTotali = eCe(['Totale ammortamenti e svalutazioni']);
  const amm_imm = eCe(['Ammortamento delle immobilizzazioni immateriali', 'Ammortamento immobilizzazioni immateriali']);
  const amm_mat = eCe(['Ammortamento delle immobilizzazioni materiali', 'Ammortamento immobilizzazioni materiali']);
  const ammortamenti = ammortamentiTotali ?? (((amm_imm ?? 0) + (amm_mat ?? 0)) || null);
  const oneri_diversi_gestione = eCe(['oneri diversi di gestione', '14) oneri diversi']);
  const totale_costi_produzione = eCe(['Totale costi della produzione']);
  const differenza_ab = eCe(['Differenza tra valore e costi della produzione']);
  const proventi_partecipazioni = eCe(['Totale proventi da partecipazioni', 'da imprese controllate']);
  const interessi_passivi = eCe(['Totale interessi e altri oneri finanziari', 'Interessi e altri oneri finanziari']);
  const risultato_ante_imposte = eCe(['Risultato prima delle imposte']);
  const imposte = eCe(['21) Imposte', '20) Imposte', 'Imposte sul reddito']);
  const utile_netto = eCe([
    '21) Utile (perdita)',
    '22) Utile (perdita)',
    '23) Utile (perdita)',
    '24) Utile (perdita)',
    'Utile (perdita) dell\'esercizio',
    'Utile netto',
    'Risultato netto',
    'Utile dell\'esercizio',
    'Perdita dell\'esercizio',
    'Risultato d\'esercizio',
    'Risultato dell\'esercizio',
  ]) ?? utile_perdita_esercizio;

  // Formato
  const isXbrl = text.includes('tassonomia itcc-ci') || text.includes('Conforme alla tassonomia');

  return {
    ragione_sociale, anno_esercizio, codice_ateco,
    totale_attivo, totale_immobilizzazioni, imm_immateriali, imm_materiali, imm_finanziarie,
    totale_attivo_circolante, rimanenze, crediti_circolante, disponibilita_liquide, ratei_risconti_attivi,
    totale_patrimonio_netto, capitale_sociale, utile_perdita_esercizio,
    fondi_rischi, tfr,
    totale_passivo,
    debiti_banche_breve: debiti_banche_breve ?? 0, debiti_banche_lungo: 0,
    debiti_altri_finanziatori: debiti_altri_finanziatori ?? 0,
    debiti_fornitori: debiti_fornitori ?? 0, debiti_tributari: debiti_tributari ?? 0,
    totale_debiti, ratei_risconti_passivi,
    ricavi_vendite, totale_valore_produzione,
    costi_materie, costi_servizi, costo_personale, ammortamenti, oneri_diversi_gestione,
    totale_costi_produzione, differenza_ab,
    proventi_partecipazioni, interessi_passivi,
    risultato_ante_imposte, imposte, utile_netto,
    formato_rilevato: isXbrl ? 'xbrl_standard' : 'libero',
  };
}

// ─── Calcolo KPI ─────────────────────────────────────────────────────────────
type Semaforo = 'verde' | 'giallo' | 'rosso' | 'nd';
interface KpiEntry { valore: number | null; formatted: string; semaforo: Semaforo; label: string }

function semaforo(v: number | null, thresholds: { green: [number, number] | null; yellow: [number, number] | null }, higherIsBetter: boolean): Semaforo {
  if (v === null || !isFinite(v)) return 'nd';
  if (thresholds.green && v >= thresholds.green[0] && v <= thresholds.green[1]) return 'verde';
  if (thresholds.yellow && v >= thresholds.yellow[0] && v <= thresholds.yellow[1]) return 'giallo';
  return 'rosso';
}

function fmtPct(v: number | null) { return v !== null ? v.toFixed(1) + '%' : 'N/D'; }
function fmtMult(v: number | null) { return v !== null ? v.toFixed(2) + 'x' : 'N/D'; }
function fmtRatio(v: number | null) { return v !== null ? v.toFixed(2) : 'N/D'; }
function fmtEur(v: number | null) {
  if (v === null) return 'N/D';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}
function fmtGiorni(v: number | null) { return v !== null ? Math.round(v) + ' gg' : 'N/D'; }

interface FinRow { rata: number; debito_residuo: number; durata_mesi: number; tipologia: string }

function calcolaKpi(d: ReturnType<typeof parseBilancio>, financing: FinRow[] = []) {
  const pn = d.totale_patrimonio_netto;
  const ta = d.totale_attivo;
  const ac = d.totale_attivo_circolante ?? 0;
  const rim = d.rimanenze ?? 0;
  const liq = d.disponibilita_liquide ?? 0;
  const td = d.totale_debiti ?? 0;
  const dbBrv = (d.debiti_banche_breve ?? 0) + (d.debiti_banche_lungo ?? 0) + (d.debiti_altri_finanziatori ?? 0);
  const passCorr = td;
  const tvp = d.totale_valore_produzione;
  // La Differenza A-B è già il risultato operativo (EBIT) prima della gestione finanziaria.
  // Se non disponibile, ricostruiamo un proxy dal risultato ante imposte neutralizzando
  // interessi passivi e proventi da partecipazioni.
  const ebit = d.differenza_ab !== null
    ? d.differenza_ab
    : d.risultato_ante_imposte !== null
      ? d.risultato_ante_imposte + (d.interessi_passivi ?? 0) - (d.proventi_partecipazioni ?? 0)
      : null;
  const ebitda = ebit !== null ? ebit + (d.ammortamenti ?? 0) : null;
  const intPass = d.interessi_passivi;
  const isHolding = (d.ricavi_vendite === 0 || d.ricavi_vendite === null) && (d.proventi_partecipazioni ?? 0) > 0;

  // ── Dati da scheda finanziamenti (se disponibili) ──────────────────────────
  const hasFin = financing.length > 0;
  const totRataMensile = hasFin ? financing.reduce((s, f) => s + Math.max(0, Number(f.rata) || 0), 0) : 0;
  const hasDebtService = totRataMensile > 0;
  const servizioDebitoAnnuo = totRataMensile * 12;           // Debt Service = Σrate × 12
  const debitoResidualeTot = hasFin
    ? financing.reduce((s, f) => s + (Number(f.debito_residuo) || 0), 0)
    : dbBrv;                                                   // fallback: debiti finanziari da SP

  // PFN: usa debito residuo reale se disponibile, altrimenti stima da SP
  const pfn = debitoResidualeTot - liq;

  // DSCR: usa servizio del debito reale se disponibile, altrimenti EBITDA/interessi
  const dscr = hasDebtService && ebitda !== null
    ? ebitda / servizioDebitoAnnuo
    : (intPass && intPass > 0 && ebitda !== null ? ebitda / intPass : null);
  const dscrLabel = hasDebtService ? 'DSCR (da finanziamenti)' : 'DSCR (approx.)';

  function kpi(label: string, valore: number | null, formatted: string, sem: Semaforo): KpiEntry {
    return { valore, formatted, semaforo: sem, label };
  }

  const currentRatio = passCorr > 0 ? ac / passCorr : null;
  const quickRatio = passCorr > 0 ? (ac - rim) / passCorr : null;
  const acidTest = passCorr > 0 ? liq / passCorr : null;
  const debtEquity = pn && pn > 0 ? td / pn : null;
  const leverage = pn && pn > 0 ? (ta ?? 0) / pn : null;
  const pnSuTa = ta && ta > 0 ? (pn ?? 0) / ta * 100 : null;
  const gradoIndebit = pn && pn > 0 ? dbBrv / pn : null;
  const roe = pn && pn > 0 ? (d.utile_netto ?? 0) / pn * 100 : null;
  const roi = ta && ta > 0 && ebit !== null ? ebit / ta * 100 : null;
  const ros = tvp && tvp > 0 && ebit !== null ? ebit / tvp * 100 : null;
  const ebitdaMargin = tvp && tvp > 0 && ebitda !== null ? ebitda / tvp * 100 : null;
  const pfnEbitda = ebitda && ebitda > 0 ? pfn / ebitda : null;
  const pfnPn = pn && pn > 0 ? pfn / pn : null;
  const dso = d.ricavi_vendite && d.ricavi_vendite > 0 && d.crediti_circolante !== null
    ? d.crediti_circolante / (d.ricavi_vendite / 365) : null;
  const dpo = d.costi_materie && d.costi_materie > 0 && d.debiti_fornitori !== null
    ? d.debiti_fornitori / (d.costi_materie / 365) : null;
  const dsi = d.costi_materie && d.costi_materie > 0 && rim > 0
    ? rim / (d.costi_materie / 365) : null;
  const intCov = intPass && intPass > 0 && ebit !== null ? ebit / intPass : null;
  // DSCR e PFN già calcolati sopra con dati finanziamenti (o fallback SP)

  return {
    is_holding: isHolding,
    ebit, ebitda, pfn,
    dscr_source: hasDebtService ? 'finanziamenti' : 'approssimato',
    servizio_debito_annuo: servizioDebitoAnnuo,
    kpi: {
      liquidita: {
        current_ratio: kpi('Current Ratio', currentRatio, fmtRatio(currentRatio),
          currentRatio === null ? 'nd' : currentRatio >= 1.5 ? 'verde' : currentRatio >= 1.0 ? 'giallo' : 'rosso'),
        quick_ratio: kpi('Quick Ratio', quickRatio, fmtRatio(quickRatio),
          quickRatio === null ? 'nd' : quickRatio >= 1.0 ? 'verde' : quickRatio >= 0.8 ? 'giallo' : 'rosso'),
        acid_test: kpi('Acid Test', acidTest, fmtRatio(acidTest),
          acidTest === null ? 'nd' : acidTest >= 0.5 ? 'verde' : acidTest >= 0.2 ? 'giallo' : 'rosso'),
      },
      solidita: {
        debt_equity: kpi('Debt/Equity', debtEquity, fmtRatio(debtEquity),
          debtEquity === null ? 'nd' : debtEquity <= 1.5 ? 'verde' : debtEquity <= 3.0 ? 'giallo' : 'rosso'),
        leverage: kpi('Leverage', leverage, fmtRatio(leverage),
          leverage === null ? 'nd' : leverage <= 2.5 ? 'verde' : leverage <= 4.0 ? 'giallo' : 'rosso'),
        pn_su_ta: kpi('PN / Totale Attivo', pnSuTa, fmtPct(pnSuTa),
          pnSuTa === null ? 'nd' : pnSuTa >= 25 ? 'verde' : pnSuTa >= 15 ? 'giallo' : 'rosso'),
        grado_indebitamento: kpi('Grado Indebitamento', gradoIndebit, fmtRatio(gradoIndebit),
          gradoIndebit === null ? 'nd' : gradoIndebit <= 1.0 ? 'verde' : gradoIndebit <= 2.0 ? 'giallo' : 'rosso'),
      },
      redditivita: {
        roe: kpi('ROE', roe, fmtPct(roe),
          roe === null ? 'nd' : roe >= 5 ? 'verde' : roe >= 0 ? 'giallo' : 'rosso'),
        roi: kpi('ROI', roi, fmtPct(roi),
          roi === null ? 'nd' : roi >= 3 ? 'verde' : roi >= 0 ? 'giallo' : 'rosso'),
        ros: kpi('ROS', ros, fmtPct(ros),
          ros === null ? 'nd' : ros >= 3 ? 'verde' : ros >= 0 ? 'giallo' : 'rosso'),
        ebitda_margin: kpi('EBITDA Margin', ebitdaMargin, fmtPct(ebitdaMargin),
          ebitdaMargin === null ? 'nd' : ebitdaMargin >= 10 ? 'verde' : ebitdaMargin >= 5 ? 'giallo' : 'rosso'),
        ebitda_eur: kpi('EBITDA (€)', ebitda, fmtEur(ebitda), ebitda === null ? 'nd' : ebitda > 0 ? 'verde' : 'rosso'),
        fatturato: kpi('Fatturato (€)', d.ricavi_vendite, fmtEur(d.ricavi_vendite), d.ricavi_vendite === null ? 'nd' : d.ricavi_vendite > 0 ? 'verde' : 'giallo'),
        utile_netto: kpi('Utile Netto (€)', d.utile_netto ?? d.utile_perdita_esercizio, fmtEur(d.utile_netto ?? d.utile_perdita_esercizio), (d.utile_netto ?? d.utile_perdita_esercizio) === null ? 'nd' : (d.utile_netto ?? d.utile_perdita_esercizio)! > 0 ? 'verde' : 'rosso'),
      },
      indebitamento: {
        pfn: kpi('PFN (€)', pfn, fmtEur(pfn), pfn <= 0 ? 'verde' : pfn <= (pn ?? 0) ? 'giallo' : 'rosso'),
        pfn_ebitda: kpi('PFN / EBITDA', pfnEbitda, pfnEbitda !== null ? pfnEbitda.toFixed(1) + 'x' : 'N/D',
          pfnEbitda === null ? 'nd' : pfnEbitda <= 3 ? 'verde' : pfnEbitda <= 5 ? 'giallo' : 'rosso'),
        pfn_pn: kpi('PFN / PN', pfnPn, fmtRatio(pfnPn),
          pfnPn === null ? 'nd' : pfnPn <= 1.0 ? 'verde' : pfnPn <= 2.0 ? 'giallo' : 'rosso'),
      },
      efficienza: {
        dso: kpi('DSO (giorni crediti)', dso, fmtGiorni(dso),
          dso === null ? 'nd' : dso <= 60 ? 'verde' : dso <= 120 ? 'giallo' : 'rosso'),
        dpo: kpi('DPO (giorni debiti)', dpo, fmtGiorni(dpo), 'nd'),
        dsi: kpi('DSI (giorni magazzino)', dsi, fmtGiorni(dsi), 'nd'),
      },
      copertura: {
        interest_coverage: kpi('Interest Coverage', intCov, fmtMult(intCov),
          intCov === null ? 'nd' : intCov >= 3 ? 'verde' : intCov >= 1.5 ? 'giallo' : 'rosso'),
        dscr: kpi(dscrLabel, dscr, fmtMult(dscr),
          dscr === null ? 'nd' : dscr >= 1.25 ? 'verde' : dscr >= 1.0 ? 'giallo' : 'rosso'),
      },
    },
  };
}

// ─── Handler principale ───────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body = await req.json();
  const { practice_id, pdf_text, uploaded_file_id, financing } = body;

  // ── Branch consulente: bilancio_testo senza practice_id ──────────────────
  // Usato dal NuovoReportWizard quando carica un bilancio PDF o XBRL direttamente.
  // Se bilancio_testo è presente, usa sempre questo branch (anche se practice_id è presente).
  const bilancio_testo: string | undefined = body.bilancio_testo;
  if (bilancio_testo) {
    if (bilancio_testo.trim().length < 50) return fail('Contenuto bilancio troppo breve o non leggibile');
    const bilData = parseBilancio(bilancio_testo);
    const { is_holding, kpi, dscr_source, servizio_debito_annuo } = calcolaKpi(bilData, financing ?? []);
    const codiceAteco: string | null = body.codice_ateco ?? bilData.codice_ateco ?? null;
    const sector = await getSectorContext(codiceAteco);
    const anomalyAnalysis = analyzeBalanceAnomalies({
      current: { ...bilData, is_holding } as BalanceSnapshot,
      rawText: bilancio_testo,
      atecoCode: codiceAteco,
      sectorKey: sector.sectorKey,
      sectorLabel: sector.sectorLabel,
      benchmark: sector.benchmark,
    });
    return ok({
      anno_esercizio: bilData.anno_esercizio,
      ragione_sociale: bilData.ragione_sociale,
      kpi,
      is_holding,
      dscr_source,
      servizio_debito_annuo,
      anomaly_analysis: anomalyAnalysis,
    });
  }

  // Flusso pratiche standard: practice_id e pdf_text obbligatori
  if (!practice_id || !pdf_text) return fail('practice_id e pdf_text sono obbligatori');

  // Parse bilancio
  const bilData = parseBilancio(pdf_text);
  const {
    is_holding,
    ebit: _ebit,
    ebitda: _ebitda,
    pfn: _pfn,
    kpi,
    dscr_source,
    servizio_debito_annuo,
  } = calcolaKpi(bilData, financing ?? []);

  const codiceAteco = await getPracticeAteco(practice_id) ?? bilData.codice_ateco ?? null;
  const sector = await getSectorContext(codiceAteco);
  const previousRows = await fetchJson<BalanceSnapshot[]>(
    `bilanci_kpi?practice_id=eq.${encodeURIComponent(practice_id)}&select=*&order=anno_esercizio.desc.nullslast&limit=5`,
  );
  const previousBalance = previousRows?.find(row =>
    row.anno_esercizio !== bilData.anno_esercizio,
  ) ?? null;
  const anomalyAnalysis = analyzeBalanceAnomalies({
    current: { ...bilData, is_holding } as BalanceSnapshot,
    previous: previousBalance,
    rawText: pdf_text,
    atecoCode: codiceAteco,
    sectorKey: sector.sectorKey,
    sectorLabel: sector.sectorLabel,
    benchmark: sector.benchmark,
  });

  // Upsert su DB via REST
  const row = {
    practice_id,
    uploaded_file_id: uploaded_file_id ?? null,
    anno_esercizio: bilData.anno_esercizio,
    ragione_sociale: bilData.ragione_sociale,
    totale_attivo: bilData.totale_attivo,
    totale_immobilizzazioni: bilData.totale_immobilizzazioni,
    imm_immateriali: bilData.imm_immateriali,
    imm_materiali: bilData.imm_materiali,
    imm_finanziarie: bilData.imm_finanziarie,
    totale_attivo_circolante: bilData.totale_attivo_circolante,
    rimanenze: bilData.rimanenze,
    crediti_circolante: bilData.crediti_circolante,
    disponibilita_liquide: bilData.disponibilita_liquide,
    ratei_risconti_attivi: bilData.ratei_risconti_attivi,
    totale_patrimonio_netto: bilData.totale_patrimonio_netto,
    capitale_sociale: bilData.capitale_sociale,
    utile_perdita_esercizio: bilData.utile_perdita_esercizio,
    fondi_rischi: bilData.fondi_rischi,
    tfr: bilData.tfr,
    debiti_banche_breve: bilData.debiti_banche_breve,
    debiti_banche_lungo: bilData.debiti_banche_lungo,
    debiti_altri_finanziatori: bilData.debiti_altri_finanziatori,
    debiti_fornitori: bilData.debiti_fornitori,
    debiti_tributari: bilData.debiti_tributari,
    totale_debiti: bilData.totale_debiti,
    ratei_risconti_passivi: bilData.ratei_risconti_passivi,
    ricavi_vendite: bilData.ricavi_vendite,
    totale_valore_produzione: bilData.totale_valore_produzione,
    costi_materie: bilData.costi_materie,
    costi_servizi: bilData.costi_servizi,
    costo_personale: bilData.costo_personale,
    ammortamenti: bilData.ammortamenti,
    oneri_diversi_gestione: bilData.oneri_diversi_gestione,
    totale_costi_produzione: bilData.totale_costi_produzione,
    differenza_ab: bilData.differenza_ab,
    proventi_partecipazioni: bilData.proventi_partecipazioni,
    interessi_passivi: bilData.interessi_passivi,
    risultato_ante_imposte: bilData.risultato_ante_imposte,
    imposte: bilData.imposte,
    utile_netto: bilData.utile_netto,
    kpi,
    is_holding,
    formato_rilevato: bilData.formato_rilevato,
    anomaly_analysis: anomalyAnalysis,
    anomaly_score: anomalyAnalysis.score,
    anomaly_level: anomalyAnalysis.level,
    anomaly_engine_version: anomalyAnalysis.engine_version,
  };

  const upsertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bilanci_kpi?on_conflict=practice_id,anno_esercizio`,
    {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(row),
    }
  );

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    return fail('Errore salvataggio DB: ' + err);
  }

  const saved = await upsertRes.json();
  return ok({
    bilancio_id: saved?.[0]?.id,
    anno: bilData.anno_esercizio,
    ragione_sociale: bilData.ragione_sociale,
    kpi,
    is_holding,
    dscr_source,
    servizio_debito_annuo,
    anomaly_analysis: anomalyAnalysis,
  });
});
